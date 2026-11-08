/**
 * Signer provenance gate: the canonical certificate must be the one on any
 * device-bound APK. Public fingerprint only — no key material here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_CERT_SHA256,
  apkSignerSha256,
  findVariantApk,
  isCanonicalSigner,
  verifyApkSigner,
} from "./verify-apk-signer.mjs";

const fakeExec = (digest) => (_cmd, _args) =>
  [
    "Verifies",
    "Verified using v2 scheme (APK Signature Scheme v2): true",
    "Signer #1 certificate DN: CN=FindBack",
    `Signer #1 certificate SHA-256 digest: ${digest.toLowerCase().replace(/:/g, "")}`,
    "Signer #1 certificate SHA-1 digest: 61e932d514a0287b7b6e49f190702cf4f7cfd18a",
  ].join("\n");

test("accepts the canonical certificate and rejects another signer", () => {
  assert.equal(isCanonicalSigner(CANONICAL_CERT_SHA256), true);
  assert.equal(isCanonicalSigner(CANONICAL_CERT_SHA256.replace(/:/g, "").toLowerCase()), true);
  const debug = "5F:9B:7D:B5:3C:5C:51:6C:D3:B3:BB:FA:2A:09:80:0F:84:1A:7D:F8";
  assert.equal(isCanonicalSigner(debug), false);
});

test("reads and normalizes the signer digest", () => {
  const digest = apkSignerSha256("/tmp/example.apk", {
    apksigner: "apksigner",
    exec: fakeExec(CANONICAL_CERT_SHA256),
  });
  assert.equal(digest, CANONICAL_CERT_SHA256);
});

test("rejects a debug-style certificate", () => {
  const debug = "5F:9B:7D:B5:3C:5C:51:6C:D3:B3:BB:FA:2A:09:80:0F:84:1A:7D:F8";
  const digest = apkSignerSha256("/tmp/example.apk", {
    apksigner: "apksigner",
    exec: () => `Signer #1 certificate SHA-256 digest: ${debug.replace(/:/g, "")}`,
  });
  assert.notEqual(digest, CANONICAL_CERT_SHA256);
});

test("missing APK and missing signer output fail closed", () => {
  assert.equal(verifyApkSigner("").ok, false);
  assert.equal(verifyApkSigner("/definitely/not/here.apk").ok, false);
  assert.throws(
    () => apkSignerSha256("/tmp/example.apk", { apksigner: "apksigner", exec: () => "Verifies" }),
    /no signer certificate/,
  );
});

test("findVariantApk returns null for an absent variant directory", () => {
  const root = "/definitely/not/a/repository";
  assert.equal(findVariantApk("signeddev", { root }), null);
});
