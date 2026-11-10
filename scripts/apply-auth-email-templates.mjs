#!/usr/bin/env node
/**
 * Applies the canonical auth email templates to the hosted Norfold project.
 *
 * The app signs up and resets passwords with six-digit codes, so the hosted
 * GoTrue templates are part of the product, not decoration. They live in
 * supabase/email-templates/ and are copied here by an owner-dispatched workflow
 * rather than hand-pasted, so the repository stays the only source of truth.
 *
 * Safety shape, in order:
 *   1. refuse to run outside the exact workflow context (repo, ref, actor, sha)
 *   2. refuse to run without a Management API token
 *   3. validate every template locally before any network call
 *   4. read the current config first
 *   5. PATCH only the four template fields, never the whole config
 *   6. read the config again and compare it to what was sent
 *
 * Never prints the access token and never prints a template body. The report
 * carries subject lines, content digests and booleans only.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "sheikhti1205/Norfold";
const OWNER = "sheikhti1205";

export const PROJECT_REF = "nfjhpigbsyyoaaktfaev";
export const WORKFLOW_FILE = "auth-email-templates.yml";
export const TEMPLATE_DIR = "supabase/email-templates";
const API_BASE = "https://api.supabase.com/v1/projects";

/**
 * One entry per auth email flow this job owns.
 *
 * `allowConfirmationUrl` records intent, not capability: the recovery email
 * must carry a code and nothing else because the app has no "open the reset
 * link" step, while signup may keep a one-tap link beside the code.
 */
export const FLOWS = [
  {
    flow: "recovery",
    file: "reset-password.html",
    subjectField: "mailer_subjects_recovery",
    contentField: "mailer_templates_recovery_content",
    requireToken: true,
    allowConfirmationUrl: false,
  },
  {
    flow: "confirmation",
    file: "confirm-signup.html",
    subjectField: "mailer_subjects_confirmation",
    contentField: "mailer_templates_confirmation_content",
    requireToken: true,
    allowConfirmationUrl: true,
  },
];

const TITLE_RE = /<title>([\s\S]*?)<\/title>/i;
/** findbackapp.social is the live origin and stays; see apps/mobile/src/brand.ts. */
const LIVE_ORIGIN_RE = /findbackapp\.(?:social|com)/gi;

/** Counts uses of the retired product name that are not part of the live origin. */
export function retiredNameHits(content) {
  return (String(content).replace(LIVE_ORIGIN_RE, "").match(/findback/gi) || []).length;
}

export function readSubject(content) {
  const match = TITLE_RE.exec(String(content));
  return match ? match[1].trim() : "";
}

export function validateTemplate({ content, requireToken = true, allowConfirmationUrl = false }) {
  const problems = [];
  const text = String(content ?? "");
  if (text.trim().length === 0) problems.push("template is empty");

  const subject = readSubject(text);
  if (!subject) problems.push("template has no <title> to use as the subject");
  // A subject is plain text: an entity reaches the inbox literally.
  if (/&[a-z]+;|&#\d+;/i.test(subject)) problems.push("subject contains an HTML entity, which mail clients do not decode");
  if (subject.length > 120) problems.push("subject is longer than 120 characters");

  const retired = retiredNameHits(text);
  if (retired > 0) problems.push(`template still names the retired product (${retired} hit(s) outside the live origin)`);

  const tokenHits = (text.match(/\{\{\s*\.Token\s*\}\}/g) || []).length;
  if (requireToken && tokenHits !== 1) problems.push(`template must contain exactly one {{ .Token }} (found ${tokenHits})`);
  if (!requireToken && tokenHits > 0) problems.push("this flow does not accept a code, so the template must not print {{ .Token }}");

  const urlHits = (text.match(/ConfirmationURL/g) || []).length;
  if (!allowConfirmationUrl && urlHits > 0) problems.push("this flow must not carry a ConfirmationURL");
  if (!allowConfirmationUrl && /<a\s/i.test(text)) problems.push("this flow must not carry an anchor");

  return { ok: problems.length === 0, problems, subject };
}

/** Returns the list of things wrong with the execution context; empty when trusted. */
export function contextProblems(env, headSha) {
  const problems = [];
  const expected = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: REPO,
    GITHUB_REF: "refs/heads/main",
    GITHUB_ACTOR: OWNER,
    GITHUB_TRIGGERING_ACTOR: OWNER,
    GITHUB_WORKFLOW_REF: `${REPO}/.github/workflows/${WORKFLOW_FILE}@refs/heads/main`,
  };
  for (const [name, value] of Object.entries(expected)) {
    if ((env[name] ?? "") !== value) problems.push(`${name} is not the expected value`);
  }
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")) problems.push("GITHUB_SHA is not a full commit sha");
  if ((headSha ?? "") !== env.GITHUB_SHA) problems.push("the checked-out commit is not the dispatched commit");
  return problems;
}

const digest = (value) => createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
/** CRLF tolerance only; cannot hide a real content difference. */
const normalise = (value) => String(value ?? "").replace(/\r\n/g, "\n");

export async function applyAuthEmailTemplates({
  env = process.env,
  fetchImpl = fetch,
  readTemplate,
  headSha = "",
  emit = (result) => console.log(JSON.stringify(result)),
} = {}) {
  const finish = (result) => {
    emit(result);
    return result.status === "verified" ? 0 : 1;
  };

  const untrusted = contextProblems(env, headSha);
  if (untrusted.length > 0) {
    return finish({ status: "refused", reason: "untrusted execution context", problems: untrusted });
  }

  const token = env.SUPABASE_ACCESS_TOKEN;
  if (typeof token !== "string" || token.length === 0 || /\s/.test(token)) {
    return finish({ status: "blocked", reason: "SUPABASE_ACCESS_TOKEN is not available to this job" });
  }

  // Validate everything locally before the first network call.
  const staged = [];
  const rejected = [];
  for (const spec of FLOWS) {
    let content;
    try {
      content = readTemplate(spec.file);
    } catch {
      return finish({ status: "rejected", reason: `cannot read ${TEMPLATE_DIR}/${spec.file}` });
    }
    const checked = validateTemplate({
      content,
      requireToken: spec.requireToken,
      allowConfirmationUrl: spec.allowConfirmationUrl,
    });
    if (!checked.ok) rejected.push({ flow: spec.flow, file: spec.file, problems: checked.problems });
    staged.push({ spec, content: String(content), subject: checked.subject });
  }
  if (rejected.length > 0) {
    return finish({ status: "rejected", reason: "a canonical template failed validation", templates: rejected });
  }
  // Two flows sharing a field would silently overwrite each other.
  const fields = FLOWS.flatMap((spec) => [spec.subjectField, spec.contentField]);
  if (new Set(fields).size !== fields.length) {
    return finish({ status: "rejected", reason: "two flows target the same config field" });
  }

  const url = `${API_BASE}/${PROJECT_REF}/config/auth`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const request = (init) => fetchImpl(url, { headers, redirect: "error", signal: AbortSignal.timeout(30000), ...init });

  let before;
  try {
    const response = await request({ method: "GET" });
    if (!response.ok) {
      await response.body?.cancel();
      return finish({ status: "http_error", step: "read", http: response.status });
    }
    before = await response.json();
  } catch {
    return finish({ status: "unverified", reason: "the auth config read failed" });
  }
  if (!before || typeof before !== "object") {
    return finish({ status: "unverified", reason: "the auth config read returned no object" });
  }

  // Only these fields are ever sent.
  const patch = {};
  for (const entry of staged) {
    patch[entry.spec.subjectField] = entry.subject;
    patch[entry.spec.contentField] = entry.content;
  }

  try {
    const response = await request({ method: "PATCH", body: JSON.stringify(patch) });
    if (!response.ok) {
      await response.body?.cancel();
      return finish({ status: "http_error", step: "write", http: response.status });
    }
    await response.body?.cancel();
  } catch {
    return finish({ status: "unverified", reason: "the auth config write failed; re-read the project before retrying" });
  }

  let after;
  try {
    const response = await request({ method: "GET" });
    if (!response.ok) {
      await response.body?.cancel();
      return finish({ status: "unverified", step: "verify", http: response.status });
    }
    after = await response.json();
  } catch {
    return finish({ status: "unverified", reason: "the verification read failed" });
  }
  if (!after || typeof after !== "object") {
    return finish({ status: "unverified", reason: "the verification read returned no object" });
  }

  const report = staged.map((entry) => {
    const liveSubject = after[entry.spec.subjectField];
    const liveContent = after[entry.spec.contentField];
    return {
      flow: entry.spec.flow,
      file: `${TEMPLATE_DIR}/${entry.spec.file}`,
      subject: entry.subject,
      previous_subject: typeof before[entry.spec.subjectField] === "string" ? before[entry.spec.subjectField] : null,
      subject_matches: liveSubject === entry.subject,
      content_matches: normalise(liveContent) === normalise(entry.content),
      content_sha256: digest(entry.content),
      content_bytes: Buffer.byteLength(entry.content, "utf8"),
      prints_token: /\{\{\s*\.Token\s*\}\}/.test(String(liveContent ?? "")),
      carries_confirmation_url: /ConfirmationURL/.test(String(liveContent ?? "")),
    };
  });

  const mismatched = report.filter((entry) => !entry.subject_matches || !entry.content_matches);
  const base = {
    project_ref: PROJECT_REF,
    source_sha: headSha,
    settings: {
      mailer_otp_length: after.mailer_otp_length ?? null,
      mailer_otp_exp: after.mailer_otp_exp ?? null,
    },
    templates: report,
  };

  if (mismatched.length > 0) {
    return finish({
      status: "unverified",
      reason: "the project did not return what was sent",
      ...base,
      mismatched: mismatched.map((entry) => entry.flow),
    });
  }

  return finish({ status: "verified", ...base });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let headSha = "";
  try {
    headSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // A missing checkout cannot satisfy the context check, which refuses it.
  }
  process.exitCode = await applyAuthEmailTemplates({
    headSha,
    readTemplate: (file) => readFileSync(new URL(`../${TEMPLATE_DIR}/${file}`, import.meta.url), "utf8"),
  });
}
