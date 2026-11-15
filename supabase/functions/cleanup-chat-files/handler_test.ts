import { deepStrictEqual as equal, ok } from "node:assert/strict";
import {
  chatFileMarkerFragment,
  createChatFileCleanupEndpoint,
  sweepChatFiles,
  type ChatFileSweepPorts,
} from "./handler.ts";

// Fabricated fixture values, never local credentials; all network is replaced.
const env = {
  url: "https://project.example.invalid",
  secretKeys: { default: ["sb", "secret", "unit_test_placeholder"].join("_") },
  publishableKeys: { default: "sb_publishable_unit_test_placeholder" },
  jwks: { keys: [] },
};

// A REAL client marker, produced by the encoder in
// apps/mobile/src/services/messaging/files.ts for the metadata below. The test
// decodes it again here, so a change to either encoder fails this file instead
// of quietly turning a live file into an "orphan".
const UID = "00000000-0000-4000-9855-000000000001";
const CONVERSATION = "00000000-0000-4000-9855-000000000002";
const REFERENCED_KEY =
  `files/${UID}/${CONVERSATION}/00000000-0000-4000-9855-000000000003-report.pdf`;
const REFERENCED_MARKER =
  "norfold-file:v1:eyJrIjoiZmlsZXMvMDAwMDAwMDAtMDAwMC00MDAwLTk4NTUtMDAwMDAwMDAwMDAxLzAwMDAwMDAwLTAwMDAtNDAwMC05ODU1LTAwMDAwMDAwMDAwMi8wMDAwMDAwMC0wMDAwLTQwMDAtOTg1NS0wMDAwMDAwMDAwMDMtcmVwb3J0LnBkZiIsIm4iOiJyZXBvcnQucGRmIiwibSI6ImFwcGxpY2F0aW9uL3BkZiIsInMiOjEyMzR9";
const ORPHAN_KEY = `files/${UID}/${CONVERSATION}/00000000-0000-4000-9855-000000000004-orphan.pdf`;
const DIR = `files/${UID}/${CONVERSATION}`;
const OLD = "2026-01-01T00:00:00.000Z";

type FixtureObject = { key: string; updated: string };
type FixtureEntry = { name: string; id: string | null; updated_at: string | null; metadata: null };

function fixture(
  objects: FixtureObject[],
  options: { markers?: string[]; probeFailure?: boolean; listFailure?: boolean; declineDelete?: boolean } = {},
) {
  const paths: string[] = [];
  const lists: string[] = [];
  const probes: string[] = [];
  const deletes: string[][] = [];
  const markers = options.markers ?? [];
  const remaining = [...objects];
  const transport: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const path = new URL(req.url).pathname;
    paths.push(`${req.method} ${path}`);
    ok(req.signal instanceof AbortSignal);
    if (path === "/storage/v1/object/list/findback-chat-files" && req.method === "POST") {
      if (options.listFailure) return Response.json({ message: "boom" }, { status: 503 });
      const body = await req.json() as { prefix?: string; limit?: number; offset?: number };
      const prefix = body.prefix ?? "";
      lists.push(prefix);
      const children = new Map<string, FixtureEntry>();
      for (const object of remaining) {
        if (prefix !== "" && !object.key.startsWith(`${prefix}/`)) continue;
        const rest = prefix === "" ? object.key : object.key.slice(prefix.length + 1);
        if (rest === "") continue;
        const slash = rest.indexOf("/");
        if (slash < 0) {
          children.set(rest, { name: rest, id: `id-${object.key}`, updated_at: object.updated, metadata: null });
        } else if (!children.has(rest.slice(0, slash))) {
          children.set(rest.slice(0, slash), {
            name: rest.slice(0, slash), id: null, updated_at: null, metadata: null,
          });
        }
      }
      const all = [...children.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      const offset = body.offset ?? 0;
      const limit = body.limit ?? 100;
      return Response.json(all.slice(offset, offset + limit));
    }
    if (path === "/storage/v1/object/findback-chat-files" && req.method === "DELETE") {
      const body = await req.json() as { prefixes: string[] };
      deletes.push(body.prefixes);
      if (options.declineDelete) return Response.json([]);
      const removed: { name: string }[] = [];
      for (const key of body.prefixes) {
        const index = remaining.findIndex((object) => object.key === key);
        if (index >= 0) {
          remaining.splice(index, 1);
          removed.push({ name: key });
        }
      }
      return Response.json(removed);
    }
    if (path === "/rest/v1/rpc/findback_chat_file_marker_present" && req.method === "POST") {
      if (options.probeFailure) return Response.json({ message: "boom" }, { status: 500 });
      const body = await req.json() as { p_marker: string };
      probes.push(body.p_marker);
      return Response.json(markers.some((marker) => marker.includes(body.p_marker)));
    }
    throw new Error(`Unexpected SDK operation ${req.method} ${path}`);
  };
  return { transport, paths, lists, probes, deletes, remaining };
}

const request = () => new Request("https://edge.example.invalid/cleanup-chat-files", {
  method: "POST", headers: { apikey: env.secretKeys.default },
});

Deno.test("the reference fragment is a byte-exact substring of a real client marker", () => {
  const payload = REFERENCED_MARKER.slice("norfold-file:v1:".length);
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (payload.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  equal(JSON.parse(new TextDecoder().decode(bytes)), {
    k: REFERENCED_KEY, n: "report.pdf", m: "application/pdf", s: 1234,
  });
  const fragment = chatFileMarkerFragment(REFERENCED_KEY);
  ok(fragment.startsWith("norfold-file:v1:"));
  ok(REFERENCED_MARKER.includes(fragment), "the fragment must be a prefix of a real marker");
  // A different object in the same conversation must not match this marker.
  ok(!REFERENCED_MARKER.includes(chatFileMarkerFragment(REFERENCED_KEY.replace("report.pdf", "other.pdf"))));
});

Deno.test("an old orphan is removed and a referenced object is kept", async () => {
  const f = fixture([
    { key: REFERENCED_KEY, updated: OLD },
    { key: ORPHAN_KEY, updated: OLD },
  ], { markers: [REFERENCED_MARKER] });
  const res = await createChatFileCleanupEndpoint(env, f.transport)(request());
  equal(res.status, 200);
  equal(await res.json(), { scanned: 2, removed: 1, kept: 1, errors: 0 });
  equal(f.probes, [chatFileMarkerFragment(REFERENCED_KEY)]);
  equal(f.deletes, [[ORPHAN_KEY]]);
  equal(f.remaining.map((object) => object.key), [REFERENCED_KEY]);
});

Deno.test("an object younger than the threshold is never probed or removed", async () => {
  const f = fixture([{ key: ORPHAN_KEY, updated: new Date().toISOString() }]);
  const res = await createChatFileCleanupEndpoint(env, f.transport)(request());
  equal(res.status, 200);
  equal(await res.json(), { scanned: 1, removed: 0, kept: 1, errors: 0 });
  equal(f.probes, []);
  equal(f.deletes, []);
});

Deno.test("an object with no trustworthy timestamp is kept", async () => {
  const f = fixture([{ key: ORPHAN_KEY, updated: "not-a-date" }]);
  const res = await createChatFileCleanupEndpoint(env, f.transport)(request());
  equal(res.status, 200);
  equal(await res.json(), { scanned: 1, removed: 0, kept: 1, errors: 0 });
  equal(f.probes, []);
});

Deno.test("an object outside files/ is removed once it is old, without a probe", async () => {
  const f = fixture([{ key: "stray.bin", updated: OLD }]);
  const res = await createChatFileCleanupEndpoint(env, f.transport)(request());
  equal(res.status, 200);
  equal(await res.json(), { scanned: 1, removed: 1, kept: 0, errors: 0 });
  equal(f.probes, []);
  equal(f.deletes, [["stray.bin"]]);
});

Deno.test("a reference-probe failure stops the sweep and deletes nothing", async () => {
  const f = fixture([
    { key: REFERENCED_KEY, updated: OLD },
    { key: ORPHAN_KEY, updated: OLD },
  ], { probeFailure: true });
  const res = await createChatFileCleanupEndpoint(env, f.transport)(request());
  equal(res.status, 500);
  equal(await res.json(), { error: "Cleanup unavailable" });
  equal(f.deletes, []);
});

Deno.test("a listing failure stops the sweep instead of guessing", async () => {
  const f = fixture([{ key: ORPHAN_KEY, updated: OLD }], { listFailure: true });
  const res = await createChatFileCleanupEndpoint(env, f.transport)(request());
  equal(res.status, 500);
  equal(f.deletes, []);
  equal(f.probes, []);
});

Deno.test("a removal Storage does not confirm is an error, not a removal", async () => {
  const f = fixture([{ key: ORPHAN_KEY, updated: OLD }], { declineDelete: true });
  const res = await createChatFileCleanupEndpoint(env, f.transport)(request());
  equal(res.status, 200);
  equal(await res.json(), { scanned: 1, removed: 0, kept: 0, errors: 1 });
});

Deno.test("method and body cannot turn the sweep into a caller-selected deletion", async () => {
  const f = fixture([{ key: ORPHAN_KEY, updated: OLD }]);
  const endpoint = createChatFileCleanupEndpoint(env, f.transport);
  equal((await endpoint(new Request("https://edge.example.invalid/cleanup-chat-files"))).status, 405);
  equal((await endpoint(new Request("https://edge.example.invalid/cleanup-chat-files", {
    method: "POST",
    headers: { apikey: env.secretKeys.default },
    body: '{"bucket":"findback-chat-files"}',
  }))).status, 400);
  equal(f.paths, []);
});

for (const apikey of [null, env.publishableKeys.default, ["sb", "secret", "wrong_placeholder"].join("_")]) {
  Deno.test(`sweep rejects non-secret auth without touching Storage: ${apikey === null ? "missing" : apikey.includes("publishable") ? "publishable" : "wrong"}`, async () => {
    const f = fixture([{ key: ORPHAN_KEY, updated: OLD }]);
    const headers: Record<string, string> = apikey ? { apikey } : {};
    const res = await createChatFileCleanupEndpoint(env, f.transport)(new Request(
      "https://edge.example.invalid/cleanup-chat-files", { method: "POST", headers },
    ));
    equal(res.status, 401);
    equal(f.paths, []);
  });
}

Deno.test("overlapping sweep is rejected before listing and capacity reopens afterwards", async () => {
  const f = fixture([{ key: ORPHAN_KEY, updated: OLD }]);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let lists = 0;
  const transport: typeof fetch = async (input, init) => {
    if (new URL(new Request(input, init).url).pathname.endsWith("/object/list/findback-chat-files")) {
      lists += 1;
      if (lists === 1) {
        entered();
        await hold;
      }
    }
    return await f.transport(input, init);
  };
  const endpoint = createChatFileCleanupEndpoint(env, transport);
  const first = endpoint(request());
  await started;
  let second: Response;
  try {
    second = await endpoint(request());
  } finally {
    release();
  }
  equal(second.status, 503);
  equal(await second.json(), { status: "retry" });
  equal((await first).status, 200);
  equal((await endpoint(request())).status, 200);
});

Deno.test("response never exposes object keys or raw storage errors", async () => {
  const f = fixture([
    { key: REFERENCED_KEY, updated: OLD },
    { key: ORPHAN_KEY, updated: OLD },
  ], { markers: [REFERENCED_MARKER] });
  const res = await createChatFileCleanupEndpoint(env, f.transport)(request());
  const text = JSON.stringify(await res.json());
  ok(!text.includes(ORPHAN_KEY) && !text.includes("files/") && !text.includes("boom"));
});

Deno.test("the sweep is bounded: past the cap it stops and leaves the tail", async () => {
  const objects: FixtureObject[] = [];
  for (let index = 0; index < 600; index += 1) {
    objects.push({ key: `${DIR}/${String(index).padStart(4, "0")}-orphan.pdf`, updated: OLD });
  }
  const f = fixture(objects);
  const res = await createChatFileCleanupEndpoint(env, f.transport)(request());
  equal(res.status, 200);
  const body = await res.json() as { scanned: number; removed: number; kept: number; errors: number };
  equal(body.scanned, 500);
  equal(body.removed, 500);
  equal(f.remaining.length, 100);
});

Deno.test("an expired work budget stops the run and reports a retry", async () => {
  const listed: string[] = [];
  const ports: ChatFileSweepPorts = {
    async list(folder) {
      listed.push(folder);
      return [{ name: "x.pdf", objectId: "id-1", updatedAt: OLD }];
    },
    async referenced() {
      return true;
    },
    async remove() {
      return { removed: 0, failed: 0 };
    },
  };
  // First read sets the deadline, every later read is past it.
  let reads = 0;
  const clock = () => {
    reads += 1;
    return reads === 1 ? 0 : 1_000;
  };
  const result = await sweepChatFiles(ports, {
    signal: new AbortController().signal, now: clock, budgetMs: 10,
  });
  equal(result.retry, true);
  equal(result.scanned, 0);
  equal(result.removed, 0);
  equal(listed, []);
});
