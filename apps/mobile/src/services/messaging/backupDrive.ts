/**
 * Optional encrypted Google Drive backup: a versioned manifest plus
 * content-addressed per-conversation chunks in the narrow `appDataFolder`.
 *
 * ## Why content-addressed chunks
 *
 * A chunk's Drive name contains the SHA-256 of its plaintext, so writing a
 * changed part never overwrites the part the previous manifest still points at.
 * An interrupted pass therefore leaves the previous backup fully readable; the
 * new manifest is written last, and only then are superseded objects compacted.
 *
 * ## Why one manifest per installation
 *
 * Two installations of the same account share one app folder, and Drive offers no
 * verified conditional write: an unconditional `PATCH` of a single shared manifest
 * is a last-writer-wins race, and a writer compacting from its own stale listing
 * can delete a chunk a later manifest still references. Each installation
 * therefore owns `norfold.<account>.manifest.<device>.v2.bin` and its own
 * `norfold.<account>.chunk.<device>.*` namespace. No object is shared, so
 * publication cannot clobber another writer, and compaction only ever removes
 * chunks this installation itself superseded. Reading unions every installation's
 * manifest, so one device's older snapshot cannot hide another's history.
 *
 * Version-1 objects (`...manifest.v1.bin`, `...chunk.<chat>.<sha>.v1.bin`) are
 * still read as a fallback and are never rewritten or deleted: a device that has
 * not updated may keep writing them.
 *
 * ## What a backup is
 *
 * A snapshot of accepted history and its suppressions — never mailbox receipts,
 * an outbox or per-device read state. Restoring merges through the ordinary
 * local import, which applies tombstones, unsends and clears; the caller must
 * still reconcile current conversation heads with the canonical server before
 * trusting stale content.
 *
 * ## What this module does not decide
 *
 * Drive is durable backup, never foreground transport and never authority. The
 * store is a port: production uses the Drive REST v3 client over the user's
 * separately chosen Google identity, tests use a synthetic in-memory store.
 * Every payload is sealed by `backupCrypto` before the store sees it, and the
 * key is admission-gated server-side, never stored beside the ciphertext.
 */
import type { HistorySnapshot, SnapshotAttachment, SnapshotMessage } from "./history";
import { normaliseSnapshot, validateSnapshot } from "./backup";
import { copyMediaMetadata, verifyMediaBytes } from "./media";
import { mergeReadFacts } from "./readFacts";
import { openBackupObject, sealBackupObject, sha256Hex, type BackupKey } from "./backupCrypto";
import { isUuid } from "./validation";

export const BACKUP_FORMAT = "norfold.drive.backup";
/** v3 adds media objects; v2 namespaces each installation's manifest and
 * chunks; v1 stays readable. Older manifests never carry media. */
export const BACKUP_VERSION = 3;
const LEGACY_VERSION = 1;
/** Chunk framing version, independent of the manifest format the writer uses. */
const PAYLOAD_VERSION = 1;
const LEGACY_CHUNK = /^norfold\.([0-9a-f-]{36})\.chunk\.([0-9a-f-]{36})\.([0-9a-f]{64})\.v1\.bin$/;
const LEGACY_MANIFEST = /^norfold\.([0-9a-f-]{36})\.manifest\.v1\.bin$/;
const CHUNK = /^norfold\.([0-9a-f-]{36})\.chunk\.([0-9a-f-]{36})\.([0-9a-f-]{36})\.([0-9a-f]{64})\.v2\.bin$/;
const MANIFEST = /^norfold\.([0-9a-f-]{36})\.manifest\.([0-9a-f-]{36})\.v2\.bin$/;
const MEDIA = /^norfold\.([0-9a-f-]{36})\.media\.([0-9a-f-]{36})\.([0-9a-f-]{36})\.([0-9a-f]{64})\.(\d{1,6})\.v1\.bin$/;
const HASH = /^[0-9a-f]{64}$/;

export const MAX_CONVERSATIONS = 512;
export const MAX_PARTS = 64;
export const MAX_MESSAGES_PER_PART = 500;
export const MAX_PART_BYTES = 2 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
export const MAX_SUPPRESSION_ROWS = 20_000;
/** Descendants of one account's backed-up attachment set, and their slices. */
export const MAX_MEDIA = 4_096;
export const MAX_MEDIA_PARTS = 64;
/** Bound on distinct installations whose manifests one restore will union. */
export const MAX_BACKUP_DEVICES = 16;

export interface BackupDriveFile { id: string; name: string; size: number }
export interface BackupDriveStore {
  list(): Promise<BackupDriveFile[]>;
  read(id: string): Promise<ArrayBuffer>;
  /** Overwrites `id` when given, otherwise creates in appDataFolder. */
  write(file: { id?: string; name: string; bytes: ArrayBuffer }): Promise<BackupDriveFile>;
  remove(id: string): Promise<void>;
}

export interface BackupScope { accountId: string; deviceId: string }

export interface BackupPart {
  /** 1-based position inside its conversation; content, not identity. */
  part: number;
  chunk: string;
  sha256: string;
  bytes: number;
  messages: number;
  firstSequence: number;
  lastSequence: number;
}

export interface BackupMediaPart {
  part: number;
  chunk: string;
  bytes: number;
}

/**
 * One verified attachment whose bytes live in this installation's media
 * objects. The descriptor repeats the metadata so a restore can rebuild the
 * attachment without trusting the message payload.
 */
export interface BackupMedia extends SnapshotAttachment {
  attachmentId: string;
  conversationId: string;
  parts: BackupMediaPart[];
}

export interface BackupConversation {
  conversationId: string;
  headSequence: number;
  parts: BackupPart[];
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: 1 | 2 | 3;
  accountId: string;
  deviceId: string;
  generation: string;
  exportedAt: number;
  conversations: BackupConversation[];
  /** v3 only; absent in v1/v2 objects written by older installations. */
  media?: BackupMedia[];
  tombstones: HistorySnapshot["tombstones"];
  deletedForMe: HistorySnapshot["deletedForMe"];
  clears: HistorySnapshot["clears"];
}

export type BackupDriveErrorCode =
  | "backup: invalid manifest"
  | "backup: account mismatch"
  | "backup: key generation changed"
  | "backup: empty snapshot"
  | "backup: incomplete snapshot"
  | "backup: device limit reached; remove an old device backup before adding another"
  | "backup: unsupported version"
  | "backup: chunk missing"
  | "backup: chunk mismatch";

export class BackupDriveError extends Error {
  constructor(public code: BackupDriveErrorCode) {
    super(code);
    this.name = "BackupDriveError";
  }
}

const fail = (code: BackupDriveErrorCode) => new BackupDriveError(code);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("backup: invalid manifest");
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const row = object(value);
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) {
    throw fail("backup: invalid manifest");
  }
  return row;
}
function nonNegative(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw fail("backup: invalid manifest");
  }
  return value;
}
function positive(value: unknown): number {
  const number = nonNegative(value);
  if (number < 1) throw fail("backup: invalid manifest");
  return number;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw fail("backup: invalid manifest");
  return value;
}

/**
 * A chunk name is exactly its account, installation, conversation and plaintext
 * hash. The installation segment is what makes compaction safe: this writer can
 * only ever delete objects no other installation's manifest can reference.
 */
export function chunkName(accountId: string, deviceId: string, conversationId: string,
  sha256: string): string {
  if (!isUuid(accountId) || !isUuid(deviceId) || !isUuid(conversationId) || !HASH.test(sha256)) {
    throw fail("backup: invalid manifest");
  }
  return `norfold.${accountId}.chunk.${deviceId}.${conversationId}.${sha256}.v2.bin`;
}

export function mediaName(accountId: string, deviceId: string, attachmentId: string,
  sha256: string, part: number): string {
  if (!isUuid(accountId) || !isUuid(deviceId) || !isUuid(attachmentId) || !HASH.test(sha256)
    || !Number.isSafeInteger(part) || part < 1 || part > MAX_MEDIA_PARTS) {
    throw fail("backup: invalid manifest");
  }
  return `norfold.${accountId}.media.${deviceId}.${attachmentId}.${sha256}.${part}.v1.bin`;
}

export function manifestName(accountId: string, deviceId: string): string {
  if (!isUuid(accountId) || !isUuid(deviceId)) throw fail("backup: invalid manifest");
  return `norfold.${accountId}.manifest.${deviceId}.v2.bin`;
}

/** Version-1 names: read-only legacy objects written by older installations. */
export function legacyChunkName(accountId: string, conversationId: string, sha256: string): string {
  if (!isUuid(accountId) || !isUuid(conversationId) || !HASH.test(sha256)) {
    throw fail("backup: invalid manifest");
  }
  return `norfold.${accountId}.chunk.${conversationId}.${sha256}.v1.bin`;
}

export function legacyManifestName(accountId: string): string {
  if (!isUuid(accountId)) throw fail("backup: invalid manifest");
  return `norfold.${accountId}.manifest.v1.bin`;
}

/** Storage names are transport only; their shape is re-checked on read. */
export function isBackupName(name: string, accountId: string): boolean {
  if (!isUuid(accountId)) return false;
  const manifest = MANIFEST.exec(name) ?? LEGACY_MANIFEST.exec(name);
  if (manifest) return manifest[1] === accountId;
  const chunk = CHUNK.exec(name) ?? LEGACY_CHUNK.exec(name);
  if (chunk) return chunk[1] === accountId;
  const media = MEDIA.exec(name);
  return media !== null && media[1] === accountId;
}

function isDeviceManifestName(name: string, accountId: string, deviceId: string): boolean {
  const match = MANIFEST.exec(name);
  return match !== null && match[1] === accountId && match[2] === deviceId;
}

function isDeviceChunkName(name: string, accountId: string, deviceId: string): boolean {
  const match = CHUNK.exec(name);
  return match !== null && match[1] === accountId && match[2] === deviceId;
}

function isDeviceMediaName(name: string, accountId: string, deviceId: string): boolean {
  const match = MEDIA.exec(name);
  return match !== null && match[1] === accountId && match[2] === deviceId;
}

function part(input: unknown, accountId: string, conversationId: string,
  deviceId: string | null): BackupPart {
  const row = exact(input, ["part", "chunk", "sha256", "bytes", "messages", "firstSequence", "lastSequence"]);
  const value: BackupPart = {
    part: positive(row.part),
    chunk: typeof row.chunk === "string" ? row.chunk : "",
    sha256: typeof row.sha256 === "string" ? row.sha256 : "",
    bytes: positive(row.bytes),
    messages: positive(row.messages),
    firstSequence: positive(row.firstSequence),
    lastSequence: positive(row.lastSequence),
  };
  const chunk = deviceId === null ? LEGACY_CHUNK.exec(value.chunk) : CHUNK.exec(value.chunk);
  const scoped = deviceId === null || (chunk !== null && chunk[2] === deviceId);
  const conversation = deviceId === null ? chunk?.[2] : chunk?.[3];
  const hash = deviceId === null ? chunk?.[3] : chunk?.[4];
  if (!chunk || chunk[1] !== accountId || !scoped || conversation !== conversationId || hash !== value.sha256
    || value.bytes > MAX_PART_BYTES || value.messages > MAX_MESSAGES_PER_PART
    || value.lastSequence < value.firstSequence) throw fail("backup: invalid manifest");
  return value;
}

function conversation(input: unknown, accountId: string, deviceId: string | null): BackupConversation {
  const row = exact(input, ["conversationId", "headSequence", "parts"]);
  const conversationId = isUuid(row.conversationId) ? row.conversationId : "";
  const parts = array(row.parts, MAX_PARTS).map((entry) => part(entry, accountId, conversationId, deviceId));
  if (!conversationId || parts.length === 0) throw fail("backup: invalid manifest");
  const chunks = new Set<string>();
  parts.forEach((entry, index) => {
    if (entry.part !== index + 1 || chunks.has(entry.chunk)) throw fail("backup: invalid manifest");
    chunks.add(entry.chunk);
    if (index > 0 && entry.firstSequence <= parts[index - 1]!.lastSequence) {
      throw fail("backup: invalid manifest");
    }
  });
  const headSequence = positive(row.headSequence);
  // A part cannot claim to hold history beyond the conversation's own HEAD.
  if (parts.at(-1)!.lastSequence > headSequence) throw fail("backup: invalid manifest");
  return { conversationId, headSequence, parts };
}

function tombstones(input: unknown): HistorySnapshot["tombstones"] {
  return array(input, MAX_SUPPRESSION_ROWS).map((value) => {
    const row = exact(value, ["messageId", "conversationId", "recipientId", "unsentAt", "unsentBy"]);
    if (!isUuid(row.messageId) || !isUuid(row.conversationId) || !isUuid(row.unsentBy)
      || !(row.recipientId === null || isUuid(row.recipientId))) throw fail("backup: invalid manifest");
    return { messageId: row.messageId as string, conversationId: row.conversationId as string,
      recipientId: row.recipientId as string | null, unsentAt: positive(row.unsentAt),
      unsentBy: row.unsentBy as string };
  });
}
function deletedForMe(input: unknown): HistorySnapshot["deletedForMe"] {
  return array(input, MAX_SUPPRESSION_ROWS).map((value) => {
    const row = exact(value, ["messageId", "conversationId", "deletedAt"]);
    if (!isUuid(row.messageId) || !(row.conversationId === null || isUuid(row.conversationId))) {
      throw fail("backup: invalid manifest");
    }
    return { messageId: row.messageId as string, conversationId: row.conversationId as string | null,
      deletedAt: positive(row.deletedAt) };
  });
}
function clears(input: unknown): HistorySnapshot["clears"] {
  return array(input, MAX_SUPPRESSION_ROWS).map((value) => {
    const row = exact(value, ["conversationId", "throughSequence", "clearedAt"]);
    if (!isUuid(row.conversationId)) throw fail("backup: invalid manifest");
    return { conversationId: row.conversationId as string,
      throughSequence: positive(row.throughSequence), clearedAt: positive(row.clearedAt) };
  });
}

const MANIFEST_KEYS = ["format", "version", "accountId", "deviceId", "generation", "exportedAt",
  "conversations", "tombstones", "deletedForMe", "clears"];
const MANIFEST_V3_KEYS = [...MANIFEST_KEYS, "media"];
const MEDIA_KEYS = ["attachmentId", "conversationId", "id", "messageId", "direction", "sha256", "mime",
  "byteSize", "width", "height", "durationMs", "expiresAt", "parts"];

/**
 * One attachment descriptor. `parts` may be empty: that is a row whose bytes
 * were already evicted locally, and a restore must show the same bubble rather
 * than invent bytes it never had.
 */
function mediaEntry(input: unknown, accountId: string, deviceId: string,
  conversationIds: ReadonlySet<string>): BackupMedia {
  const row = exact(input, MEDIA_KEYS);
  if (!isUuid(row.attachmentId) || row.attachmentId !== row.id || !isUuid(row.conversationId)
    || !conversationIds.has(row.conversationId as string)) throw fail("backup: invalid manifest");
  let metadata: SnapshotAttachment;
  try {
    metadata = copyMediaMetadata(row as unknown as Parameters<typeof copyMediaMetadata>[0]);
  } catch { throw fail("backup: invalid manifest"); }
  const chunks = new Set<string>();
  const parts = array(row.parts, MAX_MEDIA_PARTS).map((value, index): BackupMediaPart => {
    const part = exact(value, ["part", "chunk", "bytes"]);
    const chunk = typeof part.chunk === "string" ? part.chunk : "";
    const named = MEDIA.exec(chunk);
    if (part.part !== index + 1 || !named || chunks.has(chunk)
      || named[1] !== accountId || named[2] !== deviceId || named[3] !== metadata.id) {
      throw fail("backup: invalid manifest");
    }
    chunks.add(chunk);
    const bytes = positive(part.bytes);
    if (bytes > MAX_PART_BYTES) throw fail("backup: invalid manifest");
    return { part: index + 1, chunk, bytes };
  });
  // A descriptor that claims bytes must describe exactly the attachment it
  // names; a partial set would restore a truncated note or photo.
  if (parts.length > 0
    && parts.reduce((sum, value) => sum + value.bytes, 0) !== metadata.byteSize) {
    throw fail("backup: invalid manifest");
  }
  return { ...metadata, attachmentId: metadata.id,
    conversationId: row.conversationId as string, parts };
}

export function parseManifest(input: unknown): BackupManifest {
  const value = object(input);
  if (value.format !== BACKUP_FORMAT) throw fail("backup: invalid manifest");
  // v1 is the legacy single-manifest format, v2 the per-installation format and
  // v3 adds media: all three must stay readable after an upgrade.
  if (value.version !== LEGACY_VERSION && value.version !== 2 && value.version !== BACKUP_VERSION) {
    throw fail("backup: unsupported version");
  }
  const version = value.version;
  // `media` exists exactly where the format says it does: a v3 file without it
  // and a v2 file carrying it are both forgeries, not forward compatibility.
  const row = exact(value, version === BACKUP_VERSION ? MANIFEST_V3_KEYS : MANIFEST_KEYS);
  if (!isUuid(row.accountId) || !isUuid(row.deviceId) || !isUuid(row.generation)) {
    throw fail("backup: invalid manifest");
  }
  const accountId = isUuid(row.accountId) ? row.accountId : "";
  if (!accountId) throw fail("backup: invalid manifest");
  const deviceId = version === LEGACY_VERSION ? null : row.deviceId as string;
  const conversations = array(row.conversations, MAX_CONVERSATIONS)
    .map((entry) => conversation(entry, accountId, deviceId));
  const ids = new Set(conversations.map((entry) => entry.conversationId));
  if (ids.size !== conversations.length) throw fail("backup: invalid manifest");
  const media = version === BACKUP_VERSION
    ? array(row.media, MAX_MEDIA).map((entry) => mediaEntry(entry, accountId, deviceId as string, ids))
    : [];
  const attachmentIds = new Set(media.map((entry) => entry.attachmentId));
  if (attachmentIds.size !== media.length) throw fail("backup: invalid manifest");
  return {
    format: BACKUP_FORMAT, version,
    accountId: row.accountId as string, deviceId: row.deviceId as string,
    generation: row.generation as string, exportedAt: positive(row.exportedAt),
    conversations, media, tombstones: tombstones(row.tombstones),
    deletedForMe: deletedForMe(row.deletedForMe), clears: clears(row.clears),
  };
}

function portable(message: SnapshotMessage): Record<string, unknown> {
  // Always the full v3 shape: a partial record cannot be re-read by the shared
  // snapshot parser, and `null` is the format's "absent", not `undefined`.
  return {
    id: message.id, conversationId: message.conversationId,
    authorId: message.authorId, recipientId: message.recipientId, body: message.body,
    messageType: message.messageType ?? null,
    ...mergeReadFacts(message),
    contextReportId: message.contextReportId ?? null,
    replyToId: message.replyToId ?? null,
    location: message.location ?? null,
    serverEventId: message.serverEventId, serverSequence: message.serverSequence,
    unsentAt: message.unsentAt, createdAt: message.createdAt,
  };
}

interface PreparedPart { plaintext: Uint8Array; sha256: string; messages: SnapshotMessage[] }

/** Sealed framing overhead: version byte + IV + GCM tag, plus slack. */
const FRAMING_BYTES = 64;
const MAX_PART_PLAINTEXT = MAX_PART_BYTES - FRAMING_BYTES;

function encodePart(messages: SnapshotMessage[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ version: PAYLOAD_VERSION,
    messages: messages.map(portable) }));
}

/**
 * Split one conversation's messages into ordered parts, each under both the
 * message and byte bounds. The bound is checked on plaintext with framing
 * headroom reserved so no sealed part can exceed the manifest's own limit.
 */
function partition(messages: SnapshotMessage[]): PreparedPart[] {
  const ordered = [...messages].sort((a, b) => a.serverSequence - b.serverSequence);
  const parts: PreparedPart[] = [];
  let current: SnapshotMessage[] = [];
  const flush = () => {
    if (current.length === 0) return;
    parts.push({ plaintext: encodePart(current), sha256: "", messages: current });
    current = [];
  };
  for (const message of ordered) {
    if (current.length === MAX_MESSAGES_PER_PART) flush();
    current.push(message);
    if (encodePart(current).byteLength > MAX_PART_PLAINTEXT) {
      // The message that crossed the line may need a part of its own; one too
      // large for any part is a refusal, not a silent oversize upload.
      const last = current.pop()!;
      flush();
      if (encodePart([last]).byteLength > MAX_PART_PLAINTEXT) throw fail("backup: invalid manifest");
      current.push(last);
    }
    if (parts.length >= MAX_PARTS) throw fail("backup: invalid manifest");
  }
  flush();
  if (parts.length > MAX_PARTS) throw fail("backup: invalid manifest");
  return parts;
}

export interface BackupUploadReport {
  uploaded: number;
  reused: number;
  removed: number;
  conversations: number;
  messages: number;
  attachments: number;
}

export interface BackupUploadInput {
  store: BackupDriveStore;
  key: BackupKey;
  scope: BackupScope;
  snapshot: HistorySnapshot;
  /** Verified bytes by attachment id. An id absent here is a row whose bytes
   * are gone; it is still described, never fabricated. */
  media?: ReadonlyMap<string, ArrayBuffer>;
  now: number;
  crypto?: Crypto;
  /** Legacy caller hint. Never bypasses validation of an existing backup. */
  repair?: boolean;
}

async function readManifestFile(store: BackupDriveStore, file: BackupDriveFile, key: BackupKey,
  scope: BackupScope, crypto: Crypto): Promise<BackupManifest> {
  if (file.size <= 0 || file.size > MAX_MANIFEST_BYTES) throw fail("backup: invalid manifest");
  const bytes = await store.read(file.id);
  const opened = await openBackupObject(key, file.name, bytes, crypto);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(opened)); } catch { throw fail("backup: invalid manifest"); }
  const manifest = parseManifest(value);
  if (manifest.accountId !== scope.accountId) throw fail("backup: account mismatch");
  if (manifest.generation !== key.generation) throw fail("backup: invalid manifest");
  if (manifest.version !== LEGACY_VERSION
    && !isDeviceManifestName(file.name, scope.accountId, manifest.deviceId)) {
    throw fail("backup: invalid manifest");
  }
  return manifest;
}

/** Missing local history is not deletion authority. Keep prior suppressions and
 * require every prior accepted message to remain present or explicitly retired.
 * With one manifest per installation this is a sequential preservation check
 * inside that installation's own namespace; it is not needed as arbitration
 * between installments, which no longer share an object.
 */
function assertCoverage(previous: HistorySnapshot, next: HistorySnapshot): void {
  const messages = new Map(next.messages.map(row => [row.id, row]));
  const clears = new Map(next.clears.map(row => [row.conversationId, row.throughSequence]));
  const tombstones = new Map(next.tombstones.map(row => [row.messageId, row]));
  const deletions = new Map(next.deletedForMe.map(row => [row.messageId, row]));
  const incomplete = () => { throw fail("backup: incomplete snapshot"); };
  for (const row of previous.clears) {
    if ((clears.get(row.conversationId) ?? -1) < row.throughSequence) incomplete();
  }
  for (const row of previous.tombstones) {
    const kept = tombstones.get(row.messageId);
    if (!kept || kept.conversationId !== row.conversationId || kept.unsentBy !== row.unsentBy
      || kept.recipientId !== row.recipientId) incomplete();
  }
  for (const row of previous.deletedForMe) {
    const kept = deletions.get(row.messageId);
    if (!kept || (kept.conversationId !== null && kept.conversationId !== row.conversationId)) incomplete();
  }
  for (const row of previous.messages) {
    const tombstone = tombstones.get(row.id), deletion = deletions.get(row.id);
    const retired = (clears.get(row.conversationId) ?? -1) >= row.serverSequence
      || (tombstone?.conversationId === row.conversationId
        && tombstone.unsentBy === row.authorId && tombstone.recipientId === row.recipientId)
      || (deletion !== undefined && (deletion.conversationId === null || deletion.conversationId === row.conversationId));
    const kept = messages.get(row.id);
    if (retired) continue;
    if (!kept || kept.conversationId !== row.conversationId || kept.serverSequence !== row.serverSequence
      || kept.serverEventId !== row.serverEventId || kept.authorId !== row.authorId || kept.recipientId !== row.recipientId
      || (row.body === null && kept.body !== null) || (row.unsentAt !== null && kept.unsentAt === null)) incomplete();
  }
  const priorMessages = new Map(previous.messages.map(row => [row.id, row]));
  const attachments = new Map((next.attachments ?? []).map(row => [row.id, row]));
  for (const row of previous.attachments ?? []) {
    const message = priorMessages.get(row.messageId);
    if (!message) { incomplete(); continue; }
    const tombstone = tombstones.get(message.id), deletion = deletions.get(message.id);
    const retired = (clears.get(message.conversationId) ?? -1) >= message.serverSequence
      || (tombstone?.conversationId === message.conversationId
        && tombstone.unsentBy === message.authorId && tombstone.recipientId === message.recipientId)
      || (deletion !== undefined && (deletion.conversationId === null || deletion.conversationId === message.conversationId));
    if (retired) continue;
    const kept = attachments.get(row.id);
    if (!kept || kept.messageId !== row.messageId || kept.direction !== row.direction
      || kept.sha256 !== row.sha256 || kept.mime !== row.mime || kept.byteSize !== row.byteSize) incomplete();
  }
}

/**
 * One incremental pass: chunks whose plaintext hash is already referenced are
 * reused, changed parts get new content-addressed names, and the manifest is
 * written last. Superseded objects are removed only after that write, so a
 * failure anywhere earlier leaves the previous backup readable.
 */
export async function uploadBackup(input: BackupUploadInput): Promise<BackupUploadReport> {
  const crypto = input.crypto ?? globalThis.crypto;
  const { store, key, scope, snapshot, now } = input;
  if (!Number.isSafeInteger(now) || now <= 0) throw fail("backup: invalid manifest");
  validateSnapshot(snapshot, scope.accountId);
  const ownManifestName = manifestName(scope.accountId, scope.deviceId);
  const files = (await store.list()).filter((file) => isBackupName(file.name, scope.accountId));
  const existingManifests = files.filter((file) => file.name === ownManifestName);
  if (existingManifests.length > 1) throw fail("backup: invalid manifest");
  const deviceManifestCount = files.filter((file) => MANIFEST.exec(file.name)?.[1] === scope.accountId).length;
  if (deviceManifestCount > MAX_BACKUP_DEVICES
    || (!existingManifests.length && deviceManifestCount >= MAX_BACKUP_DEVICES)) {
    throw fail("backup: device limit reached; remove an old device backup before adding another");
  }
  // An unreadable backup cannot establish what a replacement would omit.
  const previousManifest = existingManifests[0]
    ? await readManifestFile(store, existingManifests[0], key, scope, crypto) : null;
  // A device that has never published a v2 manifest may still be upgrading from
  // the single-manifest format. Cover its legacy history before superseding it,
  // and refuse rather than silently drop what only the legacy backup holds.
  const legacyFile = previousManifest ? undefined
    : files.find((file) => file.name === legacyManifestName(scope.accountId));
  const priorManifest = previousManifest
    ?? (legacyFile ? await readManifestFile(store, legacyFile, key, scope, crypto) : null);

  // An empty snapshot is not evidence that history is gone: a failed database
  // open, a wiped local store and a platform read error all look identical here.
  // Unless the snapshot itself records the deletion (clears, tombstones or
  // per-user deletions), publishing it would replace a restorable backup with an
  // empty manifest and then compact every chunk away. Refuse and keep both.
  const empty = snapshot.messages.length === 0
    && snapshot.clears.length === 0 && snapshot.tombstones.length === 0
    && snapshot.deletedForMe.length === 0;
  const storedHistory = (priorManifest?.conversations.length ?? 0) > 0
    || files.some((file) => !isDeviceManifestName(file.name, scope.accountId, scope.deviceId));
  if (empty && storedHistory) throw fail("backup: empty snapshot");
  const byName = new Map(files.map((file) => [file.name, file]));
  if (priorManifest) {
    assertCoverage(await readSnapshot(store, key, scope, priorManifest, crypto, byName), snapshot);
  }
  const byConversation = new Map<string, SnapshotMessage[]>();
  for (const message of snapshot.messages) {
    const list = byConversation.get(message.conversationId) ?? [];
    list.push(message);
    byConversation.set(message.conversationId, list);
  }
  const existing = new Map(files.map((file) => [file.name, file]));
  const previouslyReferenced = new Set<string>();
  // Only this installation's own previous manifest can justify reuse: another
  // installation's chunk is not ours to reference or to later compact.
  for (const entry of previousManifest?.conversations ?? []) {
    for (const entryPart of entry.parts) previouslyReferenced.add(entryPart.chunk);
  }

  const conversations: BackupConversation[] = [];
  const written = new Set<string>();
  const covered = new Set<string>();
  let uploaded = 0, reused = 0, messages = 0;
  for (const snapshotConversation of snapshot.conversations) {
    const rows = byConversation.get(snapshotConversation.id) ?? [];
    // An empty conversation carries no restorable content; the server's own
    // sync recreates it. The manifest cannot describe a part-less entry.
    if (rows.length === 0) continue;
    covered.add(snapshotConversation.id);
    const headSequence = rows.reduce((max, row) => Math.max(max, row.serverSequence), 0);
    const parts: BackupPart[] = [];
    for (const [index, entry] of partition(rows).entries()) {
      entry.sha256 = await sha256Hex(entry.plaintext, crypto);
      const name = chunkName(scope.accountId, scope.deviceId, snapshotConversation.id, entry.sha256);
      const file = existing.get(name);
      // Reuse only content the previous manifest actually referenced: an
      // orphan from an interrupted pass is rewritten rather than trusted.
      if (file && previouslyReferenced.has(name)) {
        reused++;
      } else {
        const bytes = await sealBackupObject(key, name, entry.plaintext, crypto);
        if (bytes.byteLength > MAX_PART_BYTES) throw fail("backup: invalid manifest");
        const writtenFile = await store.write({ id: file?.id, name, bytes });
        existing.set(name, writtenFile);
        uploaded++;
      }
      written.add(name);
      const stored = existing.get(name)!;
      parts.push({ part: index + 1, chunk: name, sha256: entry.sha256, bytes: stored.size,
        messages: entry.messages.length,
        firstSequence: entry.messages[0]!.serverSequence,
        lastSequence: entry.messages.at(-1)!.serverSequence });
      messages += entry.messages.length;
    }
    conversations.push({ conversationId: snapshotConversation.id, headSequence, parts });
  }
  // Every message must belong to a conversation this pass actually wrote;
  // silently dropping one would make the backup quietly lossy.
  for (const conversationId of byConversation.keys()) {
    if (!covered.has(conversationId)) throw fail("backup: invalid manifest");
  }

  // Attachments ride beside the transcript. Bytes are split into parts small
  // enough for the store's simple upload path, each part content-addressed and
  // sealed under its own name; the descriptor carries the full digest so a
  // restore verifies the reassembled blob against the attachment contract.
  const previousMedia = new Map((previousManifest?.media ?? []).map((entry) => [entry.attachmentId, entry]));
  const previouslyReferencedMedia = new Set<string>();
  for (const entry of previousManifest?.media ?? []) {
    for (const previousPart of entry.parts) previouslyReferencedMedia.add(previousPart.chunk);
  }
  const conversationOfMessage = new Map(snapshot.messages.map((row) => [row.id, row.conversationId]));
  const media: BackupMedia[] = [];
  const writtenMedia = new Set<string>();
  let attachments = 0;
  for (const attachment of snapshot.attachments ?? []) {
    const conversationId = conversationOfMessage.get(attachment.messageId);
    if (!conversationId || !covered.has(conversationId)) continue;
    const bytes = input.media?.get(attachment.id);
    const parts: BackupMediaPart[] = [];
    if (bytes) {
      try { await verifyMediaBytes(attachment, bytes); } catch { throw fail("backup: chunk mismatch"); }
      const source = new Uint8Array(bytes);
      const count = Math.ceil(source.byteLength / MAX_PART_PLAINTEXT);
      if (count < 1 || count > MAX_MEDIA_PARTS) throw fail("backup: invalid manifest");
      for (let index = 0; index < count; index++) {
        const slice = source.slice(index * MAX_PART_PLAINTEXT, (index + 1) * MAX_PART_PLAINTEXT);
        const sha256 = await sha256Hex(slice, crypto);
        const name = mediaName(scope.accountId, scope.deviceId, attachment.id, sha256, index + 1);
        const file = existing.get(name);
        // The same reuse rule as a transcript chunk: only content the previous
        // manifest referenced, never an orphan from an interrupted pass.
        if (!(file && previouslyReferencedMedia.has(name))) {
          const sealed = await sealBackupObject(key, name, slice, crypto);
          if (sealed.byteLength > MAX_PART_BYTES) throw fail("backup: invalid manifest");
          existing.set(name, await store.write({ id: file?.id, name, bytes: sealed }));
        }
        writtenMedia.add(name);
        // Plaintext length, not the sealed object size: the descriptor describes
        // the blob a restore must reproduce, and the reader checks both.
        parts.push({ part: index + 1, chunk: name, bytes: slice.byteLength });
      }
    } else {
      // This device no longer holds the bytes. Keep the descriptor and, when the
      // previous pass uploaded the identical blob, its parts too: dropping them
      // would make the backup lose media merely because local cache was evicted.
      const prior = previousMedia.get(attachment.id);
      if (prior) {
        if (prior.messageId !== attachment.messageId || prior.direction !== attachment.direction
          || prior.sha256 !== attachment.sha256 || prior.mime !== attachment.mime
          || prior.byteSize !== attachment.byteSize) throw fail("backup: invalid manifest");
        // Only a complete set of still-present objects is a usable carry-over;
        // a partial copy would describe a truncated blob.
        if (prior.parts.every((previousPart) => existing.has(previousPart.chunk))) {
          for (const previousPart of prior.parts) {
            parts.push({ ...previousPart });
            writtenMedia.add(previousPart.chunk);
          }
        }
      }
    }
    media.push({ ...attachment, attachmentId: attachment.id, conversationId, parts });
    attachments++;
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, accountId: scope.accountId,
    deviceId: scope.deviceId, generation: key.generation, exportedAt: now,
    conversations, media, tombstones: snapshot.tombstones, deletedForMe: snapshot.deletedForMe,
    clears: snapshot.clears,
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(manifest));
  if (plaintext.byteLength > MAX_MANIFEST_BYTES) throw fail("backup: invalid manifest");
  const sealed = await sealBackupObject(key, ownManifestName, plaintext, crypto);
  if (sealed.byteLength > MAX_MANIFEST_BYTES) throw fail("backup: invalid manifest");
  await store.write({ id: existingManifests[0]?.id, name: ownManifestName, bytes: sealed });

  // Compaction now that the new manifest is durable: this installation's own
  // superseded chunks and orphans from an interrupted pass. Only objects in this
  // installation's namespace are eligible, so no other manifest can reference
  // one; the manifest itself and every legacy v1 object are never removed, and a
  // cleanup failure cannot invalidate a published backup — the caller keeps its
  // committed receipt and a later pass retries the bounded cleanup.
  let removed = 0;
  for (const file of files) {
    const superseded = isDeviceChunkName(file.name, scope.accountId, scope.deviceId)
      ? !written.has(file.name)
      : isDeviceMediaName(file.name, scope.accountId, scope.deviceId) && !writtenMedia.has(file.name);
    if (!superseded) continue;
    try {
      await store.remove(file.id);
      removed++;
    } catch { /* retained for the next pass */ }
  }
  return { uploaded, reused, removed, conversations: conversations.length, messages, attachments };
}

export interface BackupDownload {
  manifest: BackupManifest;
  /** Normalised, validated snapshot; the caller still reconciles with the server. */
  snapshot: HistorySnapshot;
  /** Verified attachment bytes by id. A descriptor with no entry here is a row
   * whose bytes were already gone when this backup was written. */
  media: Map<string, ArrayBuffer>;
}

function chunkMessages(opened: Uint8Array, conversationId: string): SnapshotMessage[] {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(opened)); } catch { throw fail("backup: chunk mismatch"); }
  const row = exact(value, ["version", "messages"]);
  if (row.version !== PAYLOAD_VERSION) throw fail("backup: unsupported version");
  return array(row.messages, MAX_MESSAGES_PER_PART).map((entry) => {
    const message = object(entry);
    if (!isUuid(message.id) || message.conversationId !== conversationId
      || !isUuid(message.authorId) || !isUuid(message.recipientId)
      || !isUuid(message.serverEventId) || !positive(message.serverSequence)) {
      throw fail("backup: chunk mismatch");
    }
    return message as unknown as SnapshotMessage;
  });
}

/**
 * Merge every installation's snapshot into the one history a restore should see.
 *
 * The fold is ordered by `(exportedAt, deviceId)`, so the result does not depend
 * on listing order. Later snapshots win for ordinary content, while a suppression
 * (a null body, a tombstone, a clear) is a fact that an older snapshot carrying
 * the body cannot undo.
 */
function mergeSnapshots(parts: readonly { manifest: BackupManifest; snapshot: HistorySnapshot }[]): HistorySnapshot {
  const ordered = [...parts].sort((a, b) => a.manifest.exportedAt - b.manifest.exportedAt
    || a.manifest.deviceId.localeCompare(b.manifest.deviceId));
  const conversations = new Map<string, HistorySnapshot["conversations"][number]>();
  const messages = new Map<string, SnapshotMessage>();
  const tombstones = new Map<string, HistorySnapshot["tombstones"][number]>();
  const deletedForMe = new Map<string, HistorySnapshot["deletedForMe"][number]>();
  const clears = new Map<string, HistorySnapshot["clears"][number]>();
  const attachments = new Map<string, SnapshotAttachment>();
  for (const { snapshot } of ordered) {
    for (const row of snapshot.conversations) {
      const prior = conversations.get(row.id);
      conversations.set(row.id, prior ? {
        id: row.id,
        lastSequence: Math.max(prior.lastSequence, row.lastSequence),
        createdAt: prior.createdAt === 0 ? row.createdAt
          : row.createdAt === 0 ? prior.createdAt : Math.min(prior.createdAt, row.createdAt),
        updatedAt: Math.max(prior.updatedAt, row.updatedAt),
      } : { ...row });
    }
    for (const row of snapshot.messages) {
      const prior = messages.get(row.id);
      if (!prior) { messages.set(row.id, { ...row }); continue; }
      const suppressed = prior.body === null || row.body === null;
      messages.set(row.id, {
        ...row,
        ...mergeReadFacts(prior, row),
        body: suppressed ? null : row.body,
        contextReportId: suppressed ? null : row.contextReportId,
        replyToId: suppressed ? null : row.replyToId,
        location: suppressed ? null : row.location,
        unsentAt: prior.unsentAt ?? row.unsentAt,
      });
    }
    for (const row of snapshot.tombstones) {
      const prior = tombstones.get(row.messageId);
      tombstones.set(row.messageId, prior && prior.unsentAt >= row.unsentAt ? prior : { ...row });
    }
    for (const row of snapshot.deletedForMe) {
      const prior = deletedForMe.get(row.messageId);
      deletedForMe.set(row.messageId, prior ? {
        ...prior, conversationId: prior.conversationId ?? row.conversationId,
        deletedAt: Math.min(prior.deletedAt, row.deletedAt),
      } : { ...row });
    }
    for (const row of snapshot.clears) {
      const prior = clears.get(row.conversationId);
      clears.set(row.conversationId, prior ? {
        ...prior, throughSequence: Math.max(prior.throughSequence, row.throughSequence),
        clearedAt: Math.max(prior.clearedAt, row.clearedAt),
      } : { ...row });
    }
    for (const row of snapshot.attachments ?? []) {
      const prior = attachments.get(row.id);
      // Immutable media identity: two installations cannot describe one
      // attachment differently without one of them being wrong.
      if (prior && (prior.messageId !== row.messageId || prior.direction !== row.direction
        || prior.sha256 !== row.sha256 || prior.mime !== row.mime || prior.byteSize !== row.byteSize)) {
        throw fail("backup: invalid manifest");
      }
      if (!prior) attachments.set(row.id, { ...row });
    }
  }
  return {
    conversations: [...conversations.values()].sort((a, b) => a.id.localeCompare(b.id)),
    messages: [...messages.values()].sort((a, b) => a.conversationId.localeCompare(b.conversationId)
      || a.serverSequence - b.serverSequence || a.id.localeCompare(b.id)),
    attachments: [...attachments.values()].sort((a, b) => a.id.localeCompare(b.id)),
    tombstones: [...tombstones.values()],
    deletedForMe: [...deletedForMe.values()],
    clears: [...clears.values()],
  };
}

/**
 * Read, verify and assemble the backup. Every installation's manifest is read and
 * unioned; a version-1 backup is read only when no version-2 manifest exists.
 * Nothing is written to history here.
 */
export async function downloadBackup(input: { store: BackupDriveStore; key: BackupKey;
  scope: BackupScope; crypto?: Crypto }): Promise<BackupDownload> {
  const crypto = input.crypto ?? globalThis.crypto;
  const { store, key, scope } = input;
  const files = (await store.list()).filter((file) => isBackupName(file.name, scope.accountId));
  const byName = new Map(files.map((file) => [file.name, file]));
  const deviceManifests = files
    .filter((file) => MANIFEST.exec(file.name)?.[1] === scope.accountId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const legacy = files.find((file) => file.name === legacyManifestName(scope.accountId));

  if (deviceManifests.length === 0) {
    if (!legacy) throw fail("backup: chunk missing");
    const manifest = await readManifestFile(store, legacy, key, scope, crypto);
    if (manifest.version !== LEGACY_VERSION) throw fail("backup: invalid manifest");
    return { manifest, snapshot: await readSnapshot(store, key, scope, manifest, crypto, byName),
      media: new Map() };
  }
  if (deviceManifests.length > MAX_BACKUP_DEVICES) throw fail("backup: invalid manifest");

  const read: { manifest: BackupManifest; snapshot: HistorySnapshot; media: Map<string, ArrayBuffer> }[] = [];
  const devices = new Set<string>();
  for (const file of deviceManifests) {
    const manifest = await readManifestFile(store, file, key, scope, crypto);
    if (manifest.version !== 2 && manifest.version !== BACKUP_VERSION) throw fail("backup: invalid manifest");
    if (devices.has(manifest.deviceId)) throw fail("backup: invalid manifest");
    devices.add(manifest.deviceId);
    read.push({
      manifest,
      snapshot: await readSnapshot(store, key, scope, manifest, crypto, byName),
      media: await readMediaObjects(store, key, manifest, crypto, byName),
    });
  }
  read.sort((a, b) => a.manifest.exportedAt - b.manifest.exportedAt
    || a.manifest.deviceId.localeCompare(b.manifest.deviceId));
  // Later snapshots win only when they actually carry the bytes; an installation
  // that evicted a blob must not erase another's copy of it.
  const media = new Map<string, ArrayBuffer>();
  for (const entry of read) for (const [id, bytes] of entry.media) media.set(id, bytes);
  return { manifest: read.at(-1)!.manifest, snapshot: mergeSnapshots(read), media };
}

async function readSnapshot(store: BackupDriveStore, key: BackupKey, scope: BackupScope,
  manifest: BackupManifest, crypto: Crypto, byName: Map<string, BackupDriveFile>): Promise<HistorySnapshot> {
  const messages: SnapshotMessage[] = [];
  for (const entry of manifest.conversations) {
    let previousSequence = 0;
    for (const part of entry.parts) {
      const file = byName.get(part.chunk);
      if (!file) throw fail("backup: chunk missing");
      const bytes = await store.read(file.id);
      const opened = await openBackupObject(key, part.chunk, bytes, crypto);
      if (await sha256Hex(opened, crypto) !== part.sha256) throw fail("backup: chunk mismatch");
      const rows = chunkMessages(opened, entry.conversationId);
      if (rows.length !== part.messages) throw fail("backup: chunk mismatch");
      for (const message of rows) {
        // Sequences ascend across every part of one conversation.
        if (message.serverSequence <= previousSequence) throw fail("backup: chunk mismatch");
        previousSequence = message.serverSequence;
        messages.push(message);
      }
      if (rows.at(0)!.serverSequence !== part.firstSequence
        || rows.at(-1)!.serverSequence !== part.lastSequence) throw fail("backup: chunk mismatch");
    }
  }
  const snapshot = normaliseSnapshot({
    conversations: manifest.conversations.map((entry) => ({
      id: entry.conversationId, lastSequence: entry.headSequence,
      createdAt: 0, updatedAt: 0,
    })),
    messages,
    attachments: (manifest.media ?? []).map((entry) => ({
      id: entry.id, messageId: entry.messageId, direction: entry.direction,
      sha256: entry.sha256, mime: entry.mime, byteSize: entry.byteSize,
      width: entry.width, height: entry.height, durationMs: entry.durationMs,
      expiresAt: entry.expiresAt,
    })),
    tombstones: manifest.tombstones,
    deletedForMe: manifest.deletedForMe,
    clears: manifest.clears,
  });
  validateSnapshot(snapshot, scope.accountId);
  return snapshot;
}

/**
 * Read and verify every media blob this manifest describes. Each part is
 * content-addressed and sealed on its own, so a missing or altered part is
 * detected before the descriptors are handed to a restore.
 */
async function readMediaObjects(store: BackupDriveStore, key: BackupKey, manifest: BackupManifest,
  crypto: Crypto, byName: Map<string, BackupDriveFile>): Promise<Map<string, ArrayBuffer>> {
  const media = new Map<string, ArrayBuffer>();
  for (const entry of manifest.media ?? []) {
    if (entry.parts.length === 0) continue;
    const slices: Uint8Array[] = [];
    let total = 0;
    for (const part of entry.parts) {
      const file = byName.get(part.chunk);
      if (!file) throw fail("backup: chunk missing");
      const sealed = await store.read(file.id);
      const opened = await openBackupObject(key, part.chunk, sealed, crypto);
      const named = MEDIA.exec(part.chunk)!;
      if (opened.byteLength !== part.bytes || await sha256Hex(opened, crypto) !== named[4]) {
        throw fail("backup: chunk mismatch");
      }
      slices.push(opened);
      total += opened.byteLength;
    }
    if (total !== entry.byteSize) throw fail("backup: chunk mismatch");
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const slice of slices) { joined.set(slice, offset); offset += slice.byteLength; }
    const bytes = joined.buffer;
    try { await verifyMediaBytes(entry, bytes); } catch { throw fail("backup: chunk mismatch"); }
    media.set(entry.attachmentId, bytes);
  }
  return media;
}
