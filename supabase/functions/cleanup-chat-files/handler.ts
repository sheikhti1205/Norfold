import { rejectNonEmptyBody } from "../_shared/emptyPost.ts";
import { withSupabase, type SupabaseEnv } from "npm:@supabase/server@1.6.0";

// Chat-file lifecycle sweep (owner audit 2026-11-15).
//
// A file message carries its Storage object key inside the message body; deleting
// the message clears the body and leaves the object behind. Nothing else removes
// it: `removeChatFile()` only cleans up a failed send. This worker lists the
// private bucket, asks the database whether each object is still named by a live
// message, and removes only the ones that are not.
//
// The decision is deliberately one-directional: a `false` answer from the
// reference probe deletes bytes, so the probe is the exact marker fragment the
// client writes, never a guess. The fragment is built here with the SAME
// base64url encoder `apps/mobile/src/services/messaging/files.ts` uses, and the
// handler test proves it is a substring of a real client marker.

const BUCKET = "findback-chat-files";
const MARKER_PREFIX = "norfold-file:v1:";
const FILE_PREFIX = "files/";
const YOUNG_MS = 24 * 60 * 60 * 1000;
const PAGE = 100;
const MAX_FOLDERS = 200;
const MAX_SCANNED = 500;
const REMOVE_BATCH = 50;
const WORK_BUDGET_MS = 80_000;

// Narrow schema for the one service-only boundary used here, not an untyped
// admin client or a copy of the rest of the generated schema.
type CleanupDatabase = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      findback_chat_file_marker_present: {
        Args: { p_marker: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export interface ListedEntry {
  name: string;
  /** Null for a folder; Storage assigns an id only to real objects. */
  objectId: string | null;
  updatedAt: string | null;
}

export interface ChatFileSweepPorts {
  /** One page of a folder, name-ascending. An empty array means the end. */
  list(folder: string, offset: number, signal: AbortSignal): Promise<ListedEntry[]>;
  /** True when a live chat message still contains this marker fragment. */
  referenced(marker: string, signal: AbortSignal): Promise<boolean>;
  remove(keys: string[], signal: AbortSignal): Promise<{ removed: number; failed: number }>;
}

export interface ChatFileSweepOptions {
  signal: AbortSignal;
  now?: () => number;
  youngMs?: number;
  budgetMs?: number;
  maxScanned?: number;
}

export interface ChatFileSweepResult {
  scanned: number;
  removed: number;
  kept: number;
  errors: number;
  /** True when the run stopped early (deadline/cancellation) and must retry. */
  retry: boolean;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The marker fragment that proves an object is still referenced.
 *
 * A base64url group is 4 characters for 3 bytes, so only a byte prefix whose
 * length is a multiple of 3 encodes to a prefix of the whole encoded string. The
 * client writes `{"k":<key>,"n":...}`; `JSON.stringify({ k })` gives the same
 * bytes plus a closing brace, so dropping the brace and truncating to a multiple
 * of 3 yields a fragment every real marker for this key contains. Encoding the
 * literal `{"k":"` by hand would mishandle a `"` or `\` in the file name.
 *
 * Returns "" when no trustworthy fragment exists; the caller must never delete on
 * an empty answer.
 */
export function chatFileMarkerFragment(objectKey: string): string {
  if (typeof objectKey !== "string" || objectKey === "") return "";
  const json = new TextEncoder().encode(JSON.stringify({ k: objectKey }));
  // -1 drops the closing brace so the fragment stays a strict prefix.
  const keep = 3 * Math.floor((json.length - 1) / 3);
  if (keep < 12) return "";
  return MARKER_PREFIX + base64UrlEncode(json.slice(0, keep));
}

/** An entry without a trustworthy timestamp is treated as NEW: deleting on an
 * unknown age would race a live upload. */
function isYoung(updatedAt: string | null, now: number, youngMs: number): boolean {
  const parsed = updatedAt === null ? Number.NaN : Date.parse(updatedAt);
  return !Number.isFinite(parsed) || now - parsed < youngMs;
}

/** A Storage entry name is a single path segment; anything else is malformed. */
function validSegment(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !/[/\\]/.test(name)
    && !name.includes(String.fromCharCode(0));
}

interface Candidate {
  key: string;
  updatedAt: string | null;
  /** Outside `files/`: no marker can name it, so it only needs the age check. */
  outsideFiles: boolean;
}

/**
 * Bounded sweep. It never deletes an object it could not prove unreferenced, and
 * any probe/listing failure propagates so the endpoint answers 500 instead of
 * guessing. Work is capped by objects, folders and wall clock; a bucket that
 * grows past the cap leaves later keys for a later run (stated in the README).
 */
export async function sweepChatFiles(
  io: ChatFileSweepPorts,
  options: ChatFileSweepOptions,
): Promise<ChatFileSweepResult> {
  const now = options.now ?? Date.now;
  const youngMs = options.youngMs ?? YOUNG_MS;
  const maxScanned = options.maxScanned ?? MAX_SCANNED;
  const startedAt = now();
  const deadline = startedAt + (options.budgetMs ?? WORK_BUDGET_MS);
  const signal = options.signal;
  const result: ChatFileSweepResult = { scanned: 0, removed: 0, kept: 0, errors: 0, retry: false };

  const expired = () => now() >= deadline;

  const candidates: Candidate[] = [];
  const queue: string[] = [""];
  let foldersVisited = 0;

  try {
    while (queue.length > 0) {
      signal.throwIfAborted();
      // Running out of cap is not a failure: the next scheduled run continues.
      // Only the deadline/cancellation paths below set `retry`.
      if (expired()) {
        result.retry = true;
        break;
      }
      if (foldersVisited >= MAX_FOLDERS || result.scanned >= maxScanned) break;
      const folder = queue.shift() as string;
      foldersVisited += 1;
      // files/<uid>/<conversation> is the deepest layout the client writes.
      const depth = folder === "" ? 0 : folder.split("/").filter(Boolean).length;
      for (let offset = 0; ; offset += PAGE) {
        const entries = await io.list(folder, offset, signal);
        if (!Array.isArray(entries) || entries.length > PAGE) throw new Error("Invalid listing");
        if (entries.length === 0) break;
        for (const entry of entries) {
          if (!validSegment(entry.name)) throw new Error("Invalid listing");
          const key = folder === "" ? entry.name : `${folder}/${entry.name}`;
          if (entry.objectId === null) {
            if (depth < 3) queue.push(key);
            continue;
          }
          if (result.scanned >= maxScanned) break;
          result.scanned += 1;
          candidates.push({
            key,
            updatedAt: entry.updatedAt,
            outsideFiles: !key.startsWith(FILE_PREFIX),
          });
        }
        if (entries.length < PAGE) break;
        if (result.scanned >= maxScanned) break;
        signal.throwIfAborted();
        if (expired()) {
          result.retry = true;
          break;
        }
      }
      if (result.retry) break;
    }

    const deletable: string[] = [];
    for (const candidate of candidates) {
      signal.throwIfAborted();
      if (expired()) {
        result.retry = true;
        break;
      }
      if (isYoung(candidate.updatedAt, now(), youngMs)) {
        result.kept += 1;
        continue;
      }
      if (!candidate.outsideFiles) {
        const fragment = chatFileMarkerFragment(candidate.key);
        // No trustworthy fragment means no proof of absence: keep the bytes.
        if (fragment === "") {
          result.errors += 1;
          continue;
        }
        if (await io.referenced(fragment, signal)) {
          result.kept += 1;
          continue;
        }
      }
      deletable.push(candidate.key);
    }

    for (let index = 0; index < deletable.length; index += REMOVE_BATCH) {
      signal.throwIfAborted();
      if (expired()) {
        result.retry = true;
        break;
      }
      const batch = deletable.slice(index, index + REMOVE_BATCH);
      const outcome = await io.remove(batch, signal);
      const removed = Math.max(0, Math.min(outcome.removed, batch.length));
      result.removed += removed;
      result.errors += batch.length - removed;
    }
  } catch {
    // A listing/probe failure or cancellation is not a completed sweep. Counts
    // collected so far stay visible; nothing else is deleted.
    if (signal.aborted || expired()) {
      result.retry = true;
      return result;
    }
    throw new Error("Sweep failed");
  }

  return result;
}

/** env/fetch overrides support hermetic testing and non-Deno hosts. Neither is
 * accepted from HTTP input. Runtime credentials remain inside the auth owner. */
export function createChatFileCleanupEndpoint(
  env?: Partial<SupabaseEnv>,
  transport: typeof fetch = fetch,
) {
  // One sweep per endpoint/isolate. Overlapping invocations would list the same
  // bucket twice; the scheduler retries instead of queueing more work.
  let sweeping = false;
  return async (request: Request): Promise<Response> => {
    const respond = (body: object, status: number) => Response.json(body, {
      status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
    if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
    // The lane is cron-only: no payload is input. A caller-selected bucket, key
    // or limit is refused before withSupabase buffers the body.
    const payload = rejectNonEmptyBody(request);
    if (payload) return payload;
    const invocationAbort = new AbortController();
    const invocationSignal = AbortSignal.any([request.signal, invocationAbort.signal]);
    const timer = setTimeout(() => invocationAbort.abort(), 90_000);
    // storage-js remove() takes no AbortSignal; bind its actual fetch as well.
    const boundedFetch: typeof fetch = (input, init) => transport(input, {
      ...init,
      signal: AbortSignal.any([invocationSignal,
        ...(init?.signal ? [init.signal] : []),
        ...(input instanceof Request ? [input.signal] : [])]),
    });
    const handler = withSupabase<CleanupDatabase>({
      auth: "secret", cors: false, env,
      errors: { detailed: false }, supabaseOptions: { global: { fetch: boundedFetch } },
    }, async (_req, ctx) => {
      if (sweeping) return respond({ status: "retry" }, 503);
      sweeping = true;
      try {
        const client = ctx.supabaseAdmin;
        const io: ChatFileSweepPorts = {
          async list(folder, offset, _signal) {
            const { data, error } = await client.storage.from(BUCKET).list(folder, {
              limit: PAGE, offset, sortBy: { column: "name", order: "asc" },
            });
            if (error) throw new Error("Listing unavailable");
            if (!Array.isArray(data)) throw new Error("Listing unavailable");
            return data.map((entry) => ({
              name: typeof entry.name === "string" ? entry.name : "",
              objectId: typeof entry.id === "string" ? entry.id : null,
              updatedAt: typeof entry.updated_at === "string" ? entry.updated_at : null,
            }));
          },
          async referenced(marker, signal) {
            const { data, error } = await client
              .rpc("findback_chat_file_marker_present", { p_marker: marker })
              .abortSignal(signal);
            // Never delete on an error or an unexpected shape.
            if (error) throw new Error("Reference check unavailable");
            if (typeof data !== "boolean") throw new Error("Reference check unavailable");
            return data;
          },
          async remove(keys, signal) {
            signal.throwIfAborted();
            const { data, error } = await client.storage.from(BUCKET).remove(keys);
            if (error) return { removed: 0, failed: keys.length };
            const removed = Array.isArray(data) ? data.length : 0;
            return { removed: Math.min(removed, keys.length), failed: keys.length - Math.min(removed, keys.length) };
          },
        };
        const result = await sweepChatFiles(io, { signal: invocationSignal });
        const body = {
          scanned: result.scanned, removed: result.removed, kept: result.kept, errors: result.errors,
        };
        return respond(body, result.retry ? 503 : 200);
      } catch {
        // Generic message only: never a key, bucket or raw SDK error.
        return respond({ error: "Cleanup unavailable" }, 500);
      } finally {
        sweeping = false;
      }
    });
    try {
      return await handler(request);
    } catch {
      return respond({ error: "Cleanup unavailable" }, 500);
    } finally {
      clearTimeout(timer);
      invocationAbort.abort();
    }
  };
}
