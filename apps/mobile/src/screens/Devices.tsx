import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Check, ChevronRight, Globe, LogOut, Smartphone, TabletSmartphone, Unplug, type LucideIcon } from "lucide-react";
import { AdaptiveTaskSurface } from "../components/AdaptiveTaskSurface";
import { Button } from "../components/Button";
import { announce } from "../components/LiveRegion";
import { SettingsGroup, SettingsPage, SettingsRow, StatusPill } from "../components/settings";
import {
  describeDeviceActivity,
  describeDevicePlatform,
  listDevices,
  removeDevice,
  renameDevice,
  type SignedInDevice,
} from "../services/devices";
import { currentDeviceLabel, isPlaceholderDeviceName, type EnrollmentPlatform } from "../services/deviceLabel";
import { friendlyError } from "../utils/friendlyErrors";
import "./Devices.css";

/** One human sentence for a device operation, never raw transport text. */
function deviceError(err: unknown): string {
  return friendlyError(err).message;
}

function deviceIcon(platform: string | null): LucideIcon {
  if (platform === "android") return Smartphone;
  if (platform === "ios") return TabletSmartphone;
  return Globe;
}

/** This build's own enrollment platform, matching what Chat enrolls. */
function ownPlatform(): EnrollmentPlatform {
  return Capacitor.getPlatform() === "android" ? "android" : "web";
}

/**
 * The account's signed-in devices.
 *
 * The list is the caller's own live installations as the server reports them:
 * a friendly name, a coarse platform and recency. Identifiers, keys, sessions,
 * tokens and cursors never reach this screen. Removing another device revokes
 * its Chat and push admission there; this installation is signed out through
 * Account instead, so the row that says "This device" never offers removal.
 */
export function Devices() {
  const [rows, setRows] = useState<SignedInDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<SignedInDevice | null>(null);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const devices = await listDevices();
      if (!alive.current) return;
      // Earlier builds enrolled every browser as "Browser". This installation
      // can adopt its specific name immediately; a name the reader chose is
      // never a placeholder, so a rename is left alone. A failure keeps the
      // server's name and is retried the next time this screen opens.
      const mine = devices.find((device) => device.current);
      if (mine && isPlaceholderDeviceName(mine.name)) {
        const label = currentDeviceLabel(ownPlatform());
        // A label this build cannot make specific is not worth a write.
        if (!isPlaceholderDeviceName(label)) {
          try {
            await renameDevice(mine.deviceId, label);
            mine.name = label;
          } catch {
            // Keep what the server holds.
          }
          if (!alive.current) return;
        }
      }
      setRows(devices);
    } catch (err) {
      if (!alive.current) return;
      setError(deviceError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const closeSheet = (): void => setSelected(null);

  const renamed = (deviceId: string, name: string): void => {
    setRows((current) => current?.map((row) => row.deviceId === deviceId ? { ...row, name } : row) ?? null);
    setSelected(null);
    const sentence = `This device is now called ${name}.`;
    setNotice(sentence);
    announce(sentence);
  };

  const removed = (row: SignedInDevice): void => {
    setRows((current) => current?.filter((item) => item.deviceId !== row.deviceId) ?? null);
    setSelected(null);
    const sentence = `${row.name} was removed and signed out of Chat.`;
    setNotice(sentence);
    announce(sentence);
  };

  return (
    <SettingsPage
      title="Devices"
      description="Phones, tablets and browsers signed in to your account."
      backTo="/settings"
    >
      <SettingsGroup
        title="Signed in"
        description="Removing a device signs it out of Chat and stops its messages syncing here. Your account and posts stay."
      >
        {notice ? (
          <p role="status" data-testid="devices-notice" className="px-3 py-2 text-sm text-on-surface-variant">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" data-testid="devices-error" className="px-3 py-2 text-sm text-error">
            {error}
          </p>
        ) : null}
        {error ? (
          <button type="button" className="min-h-[48px] px-3 text-sm text-on-surface" onClick={() => void load()}>
            Retry devices
          </button>
        ) : null}

        {!error && rows === null ? (
          <p role="status" className="fb-settings-row-description">Loading your devices…</p>
        ) : null}

        {!error && rows !== null && rows.length === 0 ? (
          <p className="fb-settings-row-description">
            Devices show up here after you use Chat on them.
          </p>
        ) : null}

        {error ? null : rows?.map((row) => (
          <SettingsRow
            key={row.deviceId}
            title={row.name}
            description={`${describeDevicePlatform(row.platform)} · ${describeDeviceActivity(row.lastSeenAt)}`}
            icon={deviceIcon(row.platform)}
            badge={row.current ? <StatusPill tone="neutral">This device</StatusPill> : undefined}
            onClick={() => { setNotice(null); setSelected(row); }}
          />
        ))}
      </SettingsGroup>

      <DeviceSheet device={selected} onClose={closeSheet} onRenamed={renamed} onRemoved={removed} />
    </SettingsPage>
  );
}

interface DeviceSheetProps {
  device: SignedInDevice | null;
  onClose(): void;
  onRenamed(deviceId: string, name: string): void;
  onRemoved(device: SignedInDevice): void;
}

/**
 * Rename or remove one device.
 *
 * The editor is a floating task surface at every width: a centred card on a
 * desktop window and a full task surface on a phone, never a desktop sheet
 * rising from the bottom edge. The device itself is the header; the only two
 * actions are the rename form and one icon-led removal row, and removal still
 * needs a second, explicit press here rather than a browser confirm.
 */
function DeviceSheet({ device, onClose, onRenamed, onRemoved }: DeviceSheetProps) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"rename" | "remove" | null>(null);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(device?.name ?? "");
    setArmed(false);
    setError(null);
  }, [device?.deviceId, device?.name]);

  const trimmed = draft.trim();
  const canRename = device !== null && trimmed.length >= 1 && trimmed.length <= 64 && trimmed !== device.name && busy === null;
  const PlatformIcon = deviceIcon(device?.platform ?? null);

  const submitRename = async (): Promise<void> => {
    if (!device || !canRename) return;
    setBusy("rename");
    setError(null);
    try {
      await renameDevice(device.deviceId, trimmed);
      onRenamed(device.deviceId, trimmed);
    } catch (err) {
      setError(deviceError(err));
    } finally {
      setBusy(null);
    }
  };

  const submitRemove = async (): Promise<void> => {
    if (!device || busy !== null) return;
    setBusy("remove");
    setError(null);
    try {
      await removeDevice(device.deviceId);
      onRemoved(device);
    } catch (err) {
      setError(deviceError(err));
      setArmed(false);
    } finally {
      setBusy(null);
    }
  };

  const arm = (): void => {
    setArmed(true);
    setError(null);
    if (device) announce(`Remove ${device.name}? This signs it out of Chat.`);
  };

  return (
    <AdaptiveTaskSurface
      open={device !== null}
      onClose={onClose}
      title={device?.name ?? "Device"}
      description="Rename this device or remove its access."
      busy={busy !== null}
      footer={device ? <>
        <Button variant="text" disabled={busy !== null} onClick={onClose}>Close</Button>
        <Button type="submit" form="device-name-form" loading={busy === "rename"} disabled={!canRename}>
          <Check size={17} aria-hidden /> Save name
        </Button>
      </> : undefined}
    >
      <div className="fb-device-editor">
        <div className="fb-device-facts">
          <span className={`fb-device-glyph${device?.current ? " fb-device-glyph--current" : ""}`} aria-hidden="true">
            <PlatformIcon size={20} />
          </span>
          <div className="fb-device-facts-copy">
            <p data-testid="device-facts">
              {device ? `${describeDevicePlatform(device.platform)} · ${describeDeviceActivity(device.lastSeenAt)}` : ""}
            </p>
            <p className="fb-device-facts-note">
              {device?.current ? "You are using this device now." : "This device is signed in to Chat."}
            </p>
          </div>
          {device?.current ? <StatusPill tone="neutral">This device</StatusPill> : null}
        </div>

        <form
          id="device-name-form"
          className="fb-device-form"
          onSubmit={(event) => { event.preventDefault(); void submitRename(); }}
        >
          <label htmlFor="device-name">Device name</label>
          <input
            id="device-name"
            type="text"
            value={draft}
            maxLength={64}
            autoComplete="off"
            disabled={busy !== null}
            onChange={(event) => setDraft(event.target.value)}
          />
          <p>Shown only to you, up to 64 characters.</p>
        </form>

        {error ? (
          <p role="alert" className="fb-device-error">{error}</p>
        ) : null}

        <div className="fb-device-actions">
          {device?.current ? (
            <div className="fb-device-note">
              <span className="fb-device-glyph" aria-hidden="true"><LogOut size={18} /></span>
              <p>This is the device you’re using. To sign it out, use Log out in Account.</p>
            </div>
          ) : armed ? (
            <div className="fb-device-confirm">
              <p>
                Remove {device?.name}? It signs out of Chat and stops receiving messages here.
                You can sign in again on that device later.
              </p>
              <div className="fb-device-confirm-actions">
                <Button variant="error" loading={busy === "remove"} onClick={() => void submitRemove()}>
                  Remove device
                </Button>
                <Button variant="text" disabled={busy !== null} onClick={() => setArmed(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="fb-device-action"
              aria-label="Remove device…"
              disabled={busy !== null}
              onClick={arm}
            >
              <span className="fb-device-glyph fb-device-glyph--danger" aria-hidden="true"><Unplug size={18} /></span>
              <span className="fb-device-action-copy">
                <span className="fb-device-action-title">Remove device…</span>
                <span className="fb-device-action-text">Signs it out of Chat and stops its messages syncing here.</span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </AdaptiveTaskSurface>
  );
}
