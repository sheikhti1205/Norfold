import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  CloudDownload,
  CloudOff,
  CloudUpload,
  Link2,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { Button } from "../components/Button";
import { announce } from "../components/LiveRegion";
import {
  PreferenceSwitchRow,
  SettingIconTile,
  SettingsGroup,
  SettingsRow,
  StatusPill,
} from "../components/settings";
import { useAuth } from "../auth";
import type {
  BackupInventoryResult,
  BackupOperationResult,
  BackupStatus,
} from "../services/messaging/backupService";
import type { BackupInventoryEntry } from "../services/messaging/backupDrive";
import { driveBackup } from "../services/messaging/backupRuntime";
import { refreshMessaging, webInstallationId } from "../services/messaging/runtime";
import { friendlyError } from "../utils/friendlyErrors";
import "./BackupSettings.css";

/** One human sentence for a backup action; never raw transport or provider text. */
function backupError(err: unknown): string {
  // Owner actions return typed outcomes; only a local failure can still throw.
  if (err instanceof BackupActionError) return err.message;
  return friendlyError(err).message;
}
class BackupActionError extends Error {}
function requireOutcome(result: BackupOperationResult, kind: "committed" | "restored"): void {
  if (result.kind === kind) return;
  if (result.kind === "needs-connection") throw new BackupActionError("Reconnect Google Drive, then try again.");
  if (result.kind === "skipped") throw new BackupActionError(result.reason === "superseded"
    ? "Backup stopped. Check its status before trying again."
    : "Backup didn't start. Wait for Chat to connect, then try again.");
  if (result.kind === "failed") throw new BackupActionError(result.reason === "integrity"
    ? "This backup couldn't be opened safely. Your chats and existing backup have not been replaced."
    : result.reason === "snapshot"
      ? "Norfold couldn't read your chats on this device. Your existing backup was left as it was."
      : result.reason === "account"
        ? "This device can't use the backup key. Sign in again; if this device was removed, add it again."
      : result.reason === "device-limit" ? "The device backup limit has been reached. Contact support for help."
      : result.reason === "storage" ? "Backup didn't finish. Check available storage, then try again."
      : result.reason === "throttled" ? "Google Drive asked us to wait. Try again later."
      : result.reason === "provider" ? "Google Drive rejected the backup request. Try again; if it keeps happening, contact support."
      : result.reason === "offline" ? "Backup didn't finish. Check your connection, then try again."
        : "Backup didn't finish. Please try again.");
  throw new BackupActionError("This action didn't finish. Try again.");
}

/** Relative recency without an exact timestamp or implementation term. */
export function describeBackupTime(ms: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - ms);
  if (elapsed < 2 * 60_000) return "just now";
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)} minutes ago`;
  if (elapsed < 24 * 60 * 60_000) {
    const hours = Math.floor(elapsed / (60 * 60_000));
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(elapsed / (24 * 60 * 60_000));
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** A locale-formatted timestamp for the expanded stats, never a raw epoch. */
function formatBackupDate(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

/** Plaintext size of the chunk objects a manifest describes. */
function formatBackupBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function statusCopy(status: BackupStatus): { title: string; description: string;
  tone: "neutral" | "success" | "warning" | "error"; label: string } {
  switch (status.kind) {
    case "unavailable":
      return status.reason === "native"
        ? { title: "Google Drive backup", label: "Not available", tone: "neutral",
          description: "This build can't reach Google Drive. Your chats stay on this device." }
        : { title: "Google Drive backup", label: "Not set up", tone: "neutral",
          description: "Drive backup isn't configured for this build." };
    case "off":
      return { title: "Google Drive backup", label: "Off", tone: "neutral",
        description: "Back up your chats and restore them on another device." };
    case "needs-connection":
      return { title: "Google Drive backup", label: "Needs reconnecting", tone: "warning",
          description: "Reconnect Google Drive to keep backing up." };
    case "running":
      return { title: "Google Drive backup", label: "In progress", tone: "neutral",
        description: status.operation === "restore" ? "Restoring saved chats…" : "Saving your chats to Google Drive…" };
    case "stopping":
      return { title: "Google Drive backup", label: "Stopping", tone: "neutral",
        description: "Waiting for the current request to finish. New backup writes have stopped." };
    case "attention":
      return status.lastError === "auth"
        ? { title: "Google Drive backup", label: "Needs reconnecting", tone: "warning",
          description: "Reconnect Google Drive to keep backing up." }
        : status.lastError === "account"
          ? { title: "Google Drive backup", label: "Sign in again", tone: "warning",
            description: "This device can't use the backup key. Sign in again; if this device was removed, add it again." }
        : status.lastError === "throttled"
          ? { title: "Google Drive backup", label: "Waiting on Google Drive", tone: "warning",
            description: "Google Drive asked us to slow down. We'll try again automatically." }
           : { title: "Google Drive backup", label: "Needs attention", tone: "warning",
              description: status.lastError === "integrity" ? "Your existing backup couldn't be opened safely. It has not been replaced."
                : status.lastError === "device-limit" ? "The device backup limit has been reached. Contact support for help."
                : status.lastError === "storage" ? "Check available storage, then retry the backup."
                  : status.lastError === "provider" ? "Google Drive rejected the last backup request."
                  : "The last backup didn't finish. We'll retry while Norfold is open." };
    case "waiting":
      return { title: "Google Drive backup", label: "On", tone: "success",
        description: "Changes are backed up while Norfold is open. Keep it open until the backup finishes." };
    case "up-to-date":
      return { title: "Google Drive backup", label: "Up to date", tone: "success",
        description: `Last backed up ${describeBackupTime(status.lastUploadAt)}.` };
  }
}

type Inventory =
  | { state: "loading" }
  | { state: "ready"; backups: BackupInventoryEntry[] }
  | { state: "unavailable"; message: string };

/**
 * Optional encrypted backup to the user's own Google Drive.
 *
 * The Google account is chosen here and only for backup: connecting it never
 * becomes a Norfold sign-in. The screen shows friendly status, one connect or
 * reconnect action, a manual pass, the stored backups with real per-backup
 * stats, a restore for a chosen backup, and an explicit disconnect. Key
 * replacement is not offered: it needs the acceptance-gated rotation protocol.
 * Encryption happens before upload, so Google stores bytes it cannot open.
 *
 * The backup list is a read-only manifest inventory. A backup contains chats,
 * photos and files; it never contains chat preferences, and the screen says so
 * rather than inventing a "preferences" statistic.
 */
export function BackupSettings() {
  const { user, authSessionId } = useAuth();
  const backup = useMemo(() => driveBackup(), [user?.id, authSessionId]);
  const actionGeneration = useRef(0);
  const alive = useRef(true);
  const [status, setStatus] = useState<BackupStatus>(() => backup.status());
  const [busy, setBusy] = useState<null | "connect" | "upload" | "restore">(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "disconnect">(null);
  const [inventory, setInventory] = useState<Inventory>({ state: "loading" });

  const refresh = useCallback(() => setStatus(backup.status()), [backup]);

  const loadInventory = useCallback(async () => {
    if (!alive.current) return;
    const result: BackupInventoryResult = await backup.inspect();
    if (!alive.current) return;
    if (result.kind === "listed") {
      setInventory({ state: "ready", backups: result.backups });
      return;
    }
    setInventory({
      state: "unavailable",
      message: result.kind === "needs-connection" || result.kind === "unavailable"
        ? "Connect Google Drive to see your backups."
        : result.kind === "busy"
          ? "Backup is busy right now. Try again in a moment."
          : "Your backups couldn't be read right now.",
    });
  }, [backup]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    actionGeneration.current++;
    setBusy(null); setError(null); setNotice(null); setConfirm(null);
    setInventory({ state: "loading" });
    const stop = backup.subscribe(refresh);
    refresh();
    void loadInventory();
    return () => { actionGeneration.current++; stop(); };
  }, [backup, refresh, loadInventory, user?.id, authSessionId]);

  const run = async (kind: NonNullable<typeof busy>, action: (current: () => boolean) => Promise<string | null>) => {
    if (busy) return;
    const ticket = actionGeneration.current;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const sentence = await action(() => ticket === actionGeneration.current);
      if (ticket !== actionGeneration.current) return;
      refresh();
      if (sentence) {
        setNotice(sentence);
        announce(sentence);
      }
    } catch (err) {
      if (ticket === actionGeneration.current) setError(backupError(err));
    } finally {
      if (ticket === actionGeneration.current) {
        setBusy(null);
        setRestoring(null);
        refresh();
        void loadInventory();
      }
    }
  };

  const connect = () => run("connect", async () => {
    const next = await backup.connect();
    requireOutcome(next, "committed");
    return "Backup is on. Your chats are saved to your Google Drive.";
  });

  const upload = () => run("upload", async () => {
    const next = await backup.uploadNow();
    requireOutcome(next, "committed");
    return "Your chats are backed up.";
  });

  const restore = (entry: BackupInventoryEntry) => run("restore", async current => {
    setRestoring(entry.name);
    // A version-1 legacy backup has no per-installation manifest to select.
    const result = await backup.restore(entry.version === 1 ? undefined : entry.deviceId ?? undefined);
    if (!current()) return null;
    requireOutcome(result, "restored");
    if (result.kind !== "restored") return null;
    if (user) {
      try { await refreshMessaging(user.id); } catch {
        throw new BackupActionError("Your saved chats were restored, but Chat couldn't catch up. Open Chat and retry sync before relying on older messages.");
      }
    }
    const count = result.messages;
    return count === 0 ? "There was nothing to restore in that backup."
      : `Restored ${count} message${count === 1 ? "" : "s"}. Chat is catching up.`;
  });

  const disconnect = () => run("connect", async () => {
    backup.forget();
    setConfirm(null);
    return "Google Drive was disconnected. Existing backups stay in your Drive.";
  });

  const copy = statusCopy(status);
  const available = status.kind !== "unavailable";
  // Key replacement is deliberately absent: it is uncontained scope.
  // The switch shows the durable opt-in, never an inference from an error kind.
  const optIn = status.enabled;
  const running = status.kind === "running" || status.kind === "stopping";
  // A Google refusal or a sign-in problem hides the pass controls, because they
  // cannot succeed without a fresh consent or session. Integrity needs the
  // acceptance-gated repair protocol, so its upload/restore would be dead
  // controls; the switch and Disconnect stay available there.
  const actionable = optIn && (status.kind === "waiting" || status.kind === "up-to-date"
    || running
    || (status.kind === "attention" && status.lastError !== "auth"
      && status.lastError !== "account"));
  const repairNeeded = status.kind === "attention" && status.lastError === "integrity";
  const canTransfer = actionable && !repairNeeded && !status.optOutPending;
  const needsConnect = status.kind === "off" || status.kind === "needs-connection"
    || (status.kind === "attention" && (status.lastError === "auth" || status.lastError === "account"));
  // A build without a Drive client cannot ask for a connection; saying
  // "Connect Google Drive" beside "Not set up" would be a dead instruction.
  // The row explains why the list is empty without repeating the status row
  // and never claims the account has no backups.
  const inventoryMessage = inventory.state === "loading" ? null
    : status.kind === "unavailable"
      ? (status.reason === "native"
        ? "This build has no Google Drive connection, so there's nothing to list."
        : "Drive backup isn't configured in this build, so there's nothing to list.")
      : inventory.state === "unavailable" ? inventory.message : null;

  return (
    <>
      <SettingsGroup
        title="Chat backup"
        description="Save an encrypted copy of your chats privately in your Google Drive."
      >
        <SettingsRow
          title={copy.title}
          description={status.lastUploadAt !== undefined && status.kind !== "up-to-date"
            ? `${copy.description} Last backed up ${describeBackupTime(status.lastUploadAt)}.`
            : copy.description}
          icon={CloudUpload}
          iconTone="blue"
          value={<StatusPill tone={copy.tone}>{copy.label}</StatusPill>}
        />

        {status.optOutPending ? (
          <p className="fb-backup-message" role="status">
            Automatic backup is paused on this device. Turning it off hasn't been saved for the next launch.
          </p>
        ) : null}

        {notice ? (
          <p role="status" data-testid="backup-notice" className="fb-backup-message">{notice}</p>
        ) : null}
        {error ? (
          <p role="alert" data-testid="backup-error" className="fb-backup-message" data-tone="error">{error}</p>
        ) : null}

        {available && needsConnect ? (
          <SettingsRow
            title={status.kind === "needs-connection" || status.kind === "attention"
              ? "Reconnect Google Drive" : "Connect Google Drive"}
            description="Choose the Google account that stores your encrypted chats."
            icon={Link2}
            onClick={() => void connect()}
            disabled={running || busy !== null}
            value={busy === "connect" ? "Connecting…" : undefined}
          />
        ) : null}

        {available && repairNeeded ? (
          <p className="fb-backup-message">
            Backup is paused so the copy already in your Drive stays intact. Nothing has been
            deleted, and Norfold won't rebuild or replace it on its own.
          </p>
        ) : null}

        {available && actionable ? (
          <>
            <PreferenceSwitchRow
              title="Back up automatically"
              description="Batches changes every few minutes while Norfold is open."
              icon={CloudUpload}
              checked={optIn}
              disabled={busy !== null}
              onChange={(next) => {
                if (next) { void connect(); return; }
                const saved = backup.disable();
                refresh();
                setNotice(null); setError(null);
                if (!saved) {
                  const sentence = "Couldn't save this change. Try turning backup off again before reopening Norfold.";
                  setError(sentence); announce(sentence); return;
                }
                const sentence = "Automatic backup is off.";
                setNotice(sentence);
                announce(sentence);
              }}
            />
            {canTransfer ? (
              <SettingsRow
                title={busy === "upload" ? "Backing up…" : "Back up now"}
                description="Save the latest changes instead of waiting for the next pass."
                icon={RefreshCw}
                onClick={() => void upload()}
                disabled={running || busy !== null}
              />
            ) : null}
            <SettingsRow
              title="Disconnect Google Drive"
              description="Existing backups stay in your Drive."
              icon={Unplug}
              destructive
              onClick={() => { setConfirm("disconnect"); setError(null); }}
              disabled={busy !== null}
            />
          </>
        ) : null}

        {confirm === "disconnect" ? (
          <div className="fb-backup-confirm">
            <p>
              Disconnect Google Drive? Automatic backup stops, and this device forgets the connection.
              Existing backups stay in your Drive.
            </p>
            <div className="fb-backup-confirm-actions">
              <Button variant="error" loading={busy === "connect"} onClick={() => void disconnect()}>
                Disconnect
              </Button>
              <Button variant="text" disabled={busy !== null} onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title="Backups"
        description="Chats, photos and files stored in your Drive. Restoring a backup adds it here; it never deletes what you already have. Chat preferences stay in Settings and are not part of a backup."
      >
        {inventory.state === "loading" ? (
          <SettingsRow title="Checking your backups…" icon={CloudDownload} />
        ) : null}
        {inventoryMessage ? (
          <SettingsRow title="Backups unavailable" description={inventoryMessage} icon={CloudOff} />
        ) : null}
        {inventory.state === "ready" && inventory.backups.length === 0 ? (
          <SettingsRow
            title="No backups yet"
            description="Turn on backup and Norfold will save your chats here."
            icon={CloudOff}
          />
        ) : null}
        {inventory.state === "ready" ? inventory.backups.slice(0, 4).map((entry, index) => (
          <BackupEntry
            key={entry.name}
            entry={entry}
            latest={index === 0}
            busy={busy !== null || running}
            restoring={restoring === entry.name}
            onRestore={() => void restore(entry)}
          />
        )) : null}
        {inventory.state === "ready" && inventory.backups.length > 4 ? (
          <p className="fb-backup-message">
            Showing the 4 most recent of {inventory.backups.length} backups.
          </p>
        ) : null}
      </SettingsGroup>

      {available && canTransfer && inventory.state === "ready" && inventory.backups.length === 0 ? (
        <p className="fb-backup-footnote">
          A backup appears here after the first pass finishes.
        </p>
      ) : null}

      {status.diagnostic ? (
        <details className="fb-advanced-disclosure">
          <summary>Backup diagnostics</summary>
          <div>
            <p>Last attempted step: {status.diagnostic.stage} / {status.diagnostic.cause}</p>
            {status.diagnostic.detail ? <p>Internal code: {status.diagnostic.detail}</p> : null}
            {status.diagnostic.httpStatus !== undefined ? <p>HTTP {status.diagnostic.httpStatus}</p> : null}
            {status.diagnostic.providerReason ? <p>Google Drive: {status.diagnostic.providerReason}</p> : null}
          </div>
        </details>
      ) : null}
    </>
  );
}

/**
 * One stored backup: a disclosure row with the summary always visible and the
 * full statistics plus its own restore action inside. The newest row is named
 * as such; every row is a real manifest, never a merged fiction.
 */
function BackupEntry({ entry, latest, busy, restoring, onRestore }: {
  entry: BackupInventoryEntry;
  latest: boolean;
  busy: boolean;
  restoring: boolean;
  onRestore: () => void;
}) {
  const [open, setOpen] = useState(false);
  const thisDevice = entry.deviceId !== null && entry.deviceId === webInstallationId();
  const summary = entry.readable
    ? `${entry.exportedAt === null ? "Unknown time" : describeBackupTime(entry.exportedAt)} · ${plural(entry.messages, "message")} · ${plural(entry.attachments, "photo or file", "photos or files")}`
    : "This backup couldn't be opened.";
  return (
    <div className="fb-backup-entry">
      <button
        type="button"
        className="fb-settings-row fb-backup-row"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <SettingIconTile icon={latest ? CloudDownload : CloudUpload} tone={latest ? "blue" : "neutral"} />
        <span className="fb-settings-row-copy">
          <span className="fb-settings-row-title">{latest ? "Most recent backup" : "Earlier backup"}</span>
          <span className="fb-settings-row-description">{summary}</span>
        </span>
        {latest && entry.readable ? <StatusPill tone="success">Latest</StatusPill> : null}
        <ChevronDown size={18} aria-hidden="true" className="fb-settings-chevron fb-backup-chevron" />
      </button>
      {open ? (
        <div className="fb-backup-stats">
          <dl>
            <div>
              <dt>Backed up</dt>
              <dd>{entry.exportedAt === null ? "Unknown" : formatBackupDate(entry.exportedAt)}</dd>
            </div>
            <div>
              <dt>Device</dt>
              <dd>{thisDevice ? "This device" : "Another device"}</dd>
            </div>
            <div>
              <dt>Conversations</dt>
              <dd>{entry.conversations.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>{entry.messages.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Photos &amp; files</dt>
              <dd>{entry.attachments.toLocaleString()}</dd>
            </div>
            {entry.removedMessages > 0 ? (
              <div>
                <dt>Removed messages</dt>
                <dd>{entry.removedMessages.toLocaleString()}</dd>
              </div>
            ) : null}
            <div>
              <dt>Size</dt>
              <dd>{formatBackupBytes(entry.bytes)}</dd>
            </div>
          </dl>
          {!entry.readable ? (
            <p className="fb-backup-warning">
              This backup is stored, but Norfold can't open it. It can't be restored safely.
            </p>
          ) : !entry.complete ? (
            <p className="fb-backup-warning">
              Some parts of this backup are missing from Drive, so it can't be restored safely.
            </p>
          ) : (
            <Button
              variant="outline"
              loading={restoring}
              disabled={busy}
              onClick={onRestore}
            >
              Restore this backup
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
