#!/usr/bin/env node
/**
 * APK signer provenance gate.
 *
 * Device acceptance needs the ONE certificate registered with Google OAuth and
 * the deployed App-Links association. A debug-signed APK installs fine but
 * Credential Manager will not issue a Google ID token for an unregistered
 * package/SHA-1 pair, and App Links verification fails — symptoms that look
 * like product bugs on the device. This check turns that silent mistake into a
 * build failure.
 *
 * Public certificate fingerprints only; a digest is not a secret.
 *
 * CLI: `node scripts/verify-apk-signer.mjs <apk>` (exit 1 on mismatch).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Canonical findback-release certificate (matches the deployed assetlinks). */
export const CANONICAL_CERT_SHA256 =
  "34:11:5A:E9:B5:97:68:27:6B:54:D4:0B:B0:33:68:2A:46:EF:0F:39:18:D5:B7:83:26:3E:A1:83:3A:07:62:4C";

export const CANONICAL_CERT_SHA1 =
  "61:E9:32:D5:14:A0:28:7B:7B:6E:49:F1:90:70:2C:F4:F7:CF:D1:8A";

/** True when a digest names the canonical findback-release certificate. */
export function isCanonicalSigner(digest) {
  return normalizeDigest(digest) === normalizeDigest(CANONICAL_CERT_SHA256);
}

function normalizeDigest(value) {
  const hex = String(value ?? "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  if (hex.length !== 64) return hex;
  return hex.match(/.{2}/g)?.join(":") ?? hex;
}

/** Highest build-tools directory under the Android SDK, or PATH `apksigner`. */
export function resolveApksigner({ env = process.env, exists = existsSync, list = readdirSync } = {}) {
  const sdk = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT, join(homedir(), "android-sdk")]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find((value) => value.length > 0);
  if (sdk) {
    const buildTools = join(sdk, "build-tools");
    if (exists(buildTools)) {
      const versions = list(buildTools)
        .filter((name) => /^\d+(?:\.\d+)*$/.test(name))
        .sort((a, b) => {
          const left = a.split(".").map(Number);
          const right = b.split(".").map(Number);
          for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
            const diff = (right[i] ?? 0) - (left[i] ?? 0);
            if (diff !== 0) return diff;
          }
          return 0;
        });
      for (const version of versions) {
        const candidate = join(buildTools, version, "apksigner");
        if (exists(candidate)) return candidate;
      }
    }
  }
  return "apksigner";
}

/** SHA-256 digest of an APK's first signer, colon-normalized upper case. */
export function apkSignerSha256(apkPath, { exec = execFileSync, apksigner = resolveApksigner() } = {}) {
  const output = String(
    exec(apksigner, ["verify", "--print-certs", apkPath], { encoding: "utf8" }),
  );
  // build-tools 36 prints "Signer #1 certificate SHA-256 digest"; 37 prints
  // "V2 Signer: certificate SHA-256 digest". Match either.
  const match = /certificate SHA-256 digest:\s*([0-9a-f:]+)/i.exec(output);
  if (!match) throw new Error("apksigner reported no signer certificate");
  return normalizeDigest(match[1]);
}

/**
 * Verify one APK against the canonical certificate.
 * @returns {{ok: boolean, reason: string, digest: string}}
 */
export function verifyApkSigner(apkPath, options = {}) {
  const path = typeof apkPath === "string" ? apkPath.trim() : "";
  if (!path) return { ok: false, reason: "no APK path", digest: "" };
  if (!existsSync(path)) return { ok: false, reason: `${path} does not exist`, digest: "" };
  let digest;
  try {
    digest = apkSignerSha256(path, options);
  } catch (error) {
    return { ok: false, reason: `could not read the signer (${String(error.message ?? error)})`, digest: "" };
  }
  if (!isCanonicalSigner(digest)) {
    return {
      ok: false,
      reason: `signer ${digest} is not the canonical findback-release certificate`,
      digest,
    };
  }
  return { ok: true, reason: "canonical findback-release signer", digest };
}

/** Newest APK produced for one Gradle variant, or null. */
export function findVariantApk(variant, { root, exists = existsSync, list = readdirSync, stat = statSync } = {}) {
  const repository = root ?? resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const dir = resolve(repository, "apps/mobile/android/app/build/outputs/apk", String(variant));
  if (!exists(dir)) return null;
  const apks = list(dir)
    .filter((name) => name.endsWith(".apk"))
    .map((name) => resolve(dir, name))
    .filter((path) => {
      try {
        return stat(path).isFile();
      } catch {
        return false;
      }
    });
  if (apks.length === 0) return null;
  return apks.sort((a, b) => stat(b).mtimeMs - stat(a).mtimeMs)[0];
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const result = verifyApkSigner(process.argv[2]);
  if (!result.ok) {
    console.error(`verify-apk-signer: FAIL — ${result.reason}`);
    process.exit(1);
  }
  console.log(`verify-apk-signer: OK — ${result.reason}`);
}
