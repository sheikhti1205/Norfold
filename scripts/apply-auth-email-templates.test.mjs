import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FLOWS,
  PROJECT_REF,
  TEMPLATE_DIR,
  applyAuthEmailTemplates,
  contextProblems,
  readSubject,
  retiredNameHits,
  validateTemplate,
} from "./apply-auth-email-templates.mjs";

const template = (file) => readFileSync(new URL(`../${TEMPLATE_DIR}/${file}`, import.meta.url), "utf8");
const RUNTIME_TOKEN = "sbp_test_token_value_that_must_never_be_printed";

const trustedEnv = (overrides = {}) => ({
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "sheikhti1205/Norfold",
  GITHUB_REF: "refs/heads/main",
  GITHUB_ACTOR: "sheikhti1205",
  GITHUB_TRIGGERING_ACTOR: "sheikhti1205",
  GITHUB_WORKFLOW_REF: "sheikhti1205/Norfold/.github/workflows/auth-email-templates.yml@refs/heads/main",
  GITHUB_SHA: "c56038ca7db42414d4697952b777b11cc08f142f",
  SUPABASE_ACCESS_TOKEN: RUNTIME_TOKEN,
  ...overrides,
});

function json(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

/** A Management API stand-in that remembers what it was told. */
function fakeApi({ initial = {}, patchResponse, swallowPatch = false } = {}) {
  const state = {
    mailer_otp_length: 8,
    mailer_otp_exp: 3600,
    mailer_subjects_recovery: "Reset your password",
    mailer_subjects_confirmation: "Confirm your email address",
    site_url: "https://findbackapp.social",
    ...initial,
  };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body });
    if (method === "GET") return json(200, { ...state });
    if (method === "PATCH") {
      if (patchResponse) return patchResponse();
      const body = JSON.parse(init.body);
      if (!swallowPatch) Object.assign(state, body);
      return json(200, {});
    }
    throw new Error(`unexpected method ${method}`);
  };
  return { fetchImpl, calls, state };
}

const APPLIED_BY_DEFAULT = { RESET: template("reset-password.html"), SIGNUP: template("confirm-signup.html") };
const readTemplate = (file) => APPLIED_BY_DEFAULT[file === "reset-password.html" ? "RESET" : "SIGNUP"];

/** Runs the job and returns its report plus exit code. */
async function run(env, api, overrides = {}) {
  let report;
  const code = await applyAuthEmailTemplates({
    env,
    headSha: env.GITHUB_SHA,
    fetchImpl: api.fetchImpl,
    readTemplate,
    emit: (result) => { report = result; },
    ...overrides,
  });
  return { code, report };
}

test("the shipped recovery template is code-only and the signup template prints a code", () => {
  const reset = template("reset-password.html");
  const signup = template("confirm-signup.html");

  assert.equal(retiredNameHits(reset), 0, "recovery template names the retired product");
  assert.equal(retiredNameHits(signup), 0, "signup template names the retired product");
  assert.doesNotMatch(reset, /ConfirmationURL/, "the recovery email must not offer a reset link");
  assert.doesNotMatch(reset, /<a\s/i, "the recovery email must not carry an anchor");
  assert.match(reset, /\{\{\s*\.Token\s*\}\}/);
  assert.match(signup, /\{\{\s*\.Token\s*\}\}/);
});

test("the live origin is not mistaken for the retired product name", () => {
  assert.equal(retiredNameHits("Sent by Norfold · findbackapp.social"), 0);
  assert.equal(retiredNameHits("Sent by Norfold · https://findbackapp.social"), 0);
  assert.equal(retiredNameHits("Verify your FindBack email"), 1);
  assert.equal(retiredNameHits("FindBack and findback.com"), 2);
});

test("the subject comes from the template title", () => {
  assert.equal(readSubject("<html><head><title>Your Norfold reset code</title></head></html>"), "Your Norfold reset code");
  assert.equal(readSubject("<html></html>"), "");
});

test("validation rejects the failure modes that would ship a broken email", () => {
  const reset = template("reset-password.html");

  const withLink = validateTemplate({ content: reset.replace("</body>", '<a href="{{ .ConfirmationURL }}">reset</a></body>'), allowConfirmationUrl: false });
  assert.equal(withLink.ok, false);
  assert.ok(withLink.problems.some((problem) => /ConfirmationURL|anchor/.test(problem)));

  const noToken = validateTemplate({ content: reset.replace("{{ .Token }}", "123456") });
  assert.equal(noToken.ok, false);
  assert.ok(noToken.problems.some((problem) => /Token/.test(problem)));

  const retired = validateTemplate({ content: reset.replace("Norfold", "FindBack") });
  assert.equal(retired.ok, false);
  assert.ok(retired.problems.some((problem) => /retired product/.test(problem)));

  const entitySubject = validateTemplate({ content: reset.replace("<title>Your Norfold reset code</title>", "<title>You&rsquo;re reset</title>") });
  assert.equal(entitySubject.ok, false);
  assert.ok(entitySubject.problems.some((problem) => /HTML entity/.test(problem)));

  const empty = validateTemplate({ content: "   " });
  assert.equal(empty.ok, false);
});

test("contexts outside the owner dispatch are refused before any network call", async () => {
  const api = fakeApi();

  for (const override of [
    { GITHUB_ACTOR: "someone-else" },
    { GITHUB_TRIGGERING_ACTOR: "someone-else" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/testing" },
    { GITHUB_REPOSITORY: "someone/Norfold" },
    { GITHUB_WORKFLOW_REF: "sheikhti1205/Norfold/.github/workflows/other.yml@refs/heads/main" },
    { GITHUB_ACTIONS: "" },
  ]) {
    const { code, report } = await run(trustedEnv(override), api);
    assert.equal(code, 1, `expected refusal for ${JSON.stringify(override)}`);
    assert.equal(report.status, "refused");
  }
  assert.equal(api.calls.length, 0, "no request may leave the machine in a refused context");
});

test("a checkout that is not the dispatched commit is refused", async () => {
  const api = fakeApi();
  const env = trustedEnv();
  const { code, report } = await run(env, api, { headSha: "0".repeat(40) });
  assert.equal(code, 1);
  assert.equal(report.status, "refused");
  assert.equal(api.calls.length, 0);
});

test("a missing token blocks the job instead of writing", async () => {
  const api = fakeApi();
  const { code, report } = await run(trustedEnv({ SUPABASE_ACCESS_TOKEN: "" }), api);
  assert.equal(code, 1);
  assert.equal(report.status, "blocked");
  assert.equal(api.calls.length, 0);
});

test("a template that fails validation is rejected before any network call", async () => {
  const api = fakeApi();
  const poisoned = {
    RESET: template("reset-password.html").replace("</body>", '<a href="{{ .ConfirmationURL }}">reset</a></body>'),
    SIGNUP: template("confirm-signup.html"),
  };
  const { code, report } = await run(trustedEnv(), api, { readTemplate: (file) => poisoned[file === "reset-password.html" ? "RESET" : "SIGNUP"] });
  assert.equal(code, 1);
  assert.equal(report.status, "rejected");
  assert.equal(api.calls.length, 0, "validation must happen before the first request");
});

test("applies exactly the four template fields and verifies the result", async () => {
  const api = fakeApi();
  const { code, report } = await run(trustedEnv(), api);

  assert.equal(code, 0);
  assert.equal(report.status, "verified");
  assert.deepEqual(api.calls.map((call) => call.method), ["GET", "PATCH", "GET"], "read, write, then prove it");

  const sent = JSON.parse(api.calls[1].body);
  assert.deepEqual(
    Object.keys(sent).sort(),
    [
      "mailer_subjects_confirmation",
      "mailer_subjects_recovery",
      "mailer_templates_confirmation_content",
      "mailer_templates_recovery_content",
    ],
    "only the four template fields may be written",
  );
  assert.equal(sent.mailer_subjects_recovery, "Your Norfold reset code");
  assert.equal(sent.mailer_subjects_confirmation, "Confirm your Norfold email");
  assert.equal(sent.mailer_templates_recovery_content, template("reset-password.html"));
  assert.equal(sent.mailer_templates_confirmation_content, template("confirm-signup.html"));

  // Unrelated settings survive untouched.
  assert.equal(api.state.site_url, "https://findbackapp.social");
  assert.equal(api.state.mailer_otp_length, 8);

  assert.equal(report.project_ref, PROJECT_REF);
  assert.equal(report.settings.mailer_otp_length, 8);
  const [recovery, confirmation] = report.templates;
  assert.equal(recovery.flow, "recovery");
  assert.equal(recovery.content_matches, true);
  assert.equal(recovery.subject_matches, true);
  assert.equal(recovery.prints_token, true);
  assert.equal(recovery.carries_confirmation_url, false);
  assert.equal(recovery.previous_subject, "Reset your password");
  assert.equal(confirmation.carries_confirmation_url, true);
  assert.equal(confirmation.content_matches, true);
});

test("reports the token and template bodies nowhere in the output", async () => {
  const api = fakeApi();
  const { report } = await run(trustedEnv(), api);
  const serialised = JSON.stringify(report);

  assert.ok(!serialised.includes(RUNTIME_TOKEN), "the access token must never reach the log");
  assert.ok(!serialised.includes("<!doctype html>"), "a template body must never reach the log");
  assert.ok(!serialised.includes(RUNTIME_TOKEN), "token leaked");
});

test("a project that does not return what was sent is reported as unverified", async () => {
  const api = fakeApi({ swallowPatch: true });
  const { code, report } = await run(trustedEnv(), api);

  assert.equal(code, 1);
  assert.equal(report.status, "unverified");
  assert.deepEqual(report.mismatched.sort(), ["confirmation", "recovery"]);
});

test("a rejected write is reported without leaking the response body", async () => {
  const leaks = "internal detail: project nfjhpigbsyyoaaktfaev rejected mailer_subjects_recovery";
  const api = fakeApi({ patchResponse: () => ({ ok: false, status: 400, json: async () => ({ message: leaks }), text: async () => leaks }) });
  const { code, report } = await run(trustedEnv(), api);

  assert.equal(code, 1);
  assert.equal(report.status, "http_error");
  assert.equal(report.step, "write");
  assert.equal(report.http, 400);
  assert.ok(!JSON.stringify(report).includes("mailer_subjects_recovery"), "the upstream body must not be echoed");
});

test("a failed config read stops the job before writing", async () => {
  const api = fakeApi({ patchResponse: () => json(500, {}) });
  api.fetchImpl = (() => {
    const inner = api.fetchImpl;
    let first = true;
    return async (url, init = {}) => {
      if (first) {
        first = false;
        api.calls.push({ url, method: "GET", body: undefined });
        return json(403, { message: "forbidden" });
      }
      return inner(url, init);
    };
  })();
  const { code, report } = await run(trustedEnv(), api);

  assert.equal(code, 1);
  assert.equal(report.status, "http_error");
  assert.equal(report.step, "read");
  assert.equal(api.calls.filter((call) => call.method === "PATCH").length, 0);
});

test("every declared flow targets a distinct pair of config fields", () => {
  const fields = FLOWS.flatMap((flow) => [flow.subjectField, flow.contentField]);
  assert.equal(new Set(fields).size, fields.length);
  for (const flow of FLOWS) {
    assert.equal(flow.subjectField.startsWith("mailer_subjects_"), true);
    assert.equal(flow.contentField.startsWith("mailer_templates_"), true);
    assert.equal(flow.contentField.endsWith("_content"), true);
  }
});

test("contextProblems is empty only for the exact owner dispatch", () => {
  assert.deepEqual(contextProblems(trustedEnv(), trustedEnv().GITHUB_SHA), []);
  assert.ok(contextProblems(trustedEnv({ GITHUB_ACTOR: "someone-else" }), trustedEnv().GITHUB_SHA).length > 0);
  assert.ok(contextProblems(trustedEnv(), "0".repeat(40)).length > 0);
});
