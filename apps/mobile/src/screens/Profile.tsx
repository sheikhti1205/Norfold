import {
  Bookmark,
  Camera,
  Check,
  CircleAlert,
  CircleCheck,
  CloudUpload,
  Copy,
  FileStack,
  Globe,
  HelpCircle,
  Mail,
  MessagesSquare,
  MonitorSmartphone,
  Pencil,
  Send,
  Settings as SettingsIcon,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { PublicUser } from "@norfold/shared";
import { useAuth } from "../auth";
import { announce } from "../components/LiveRegion";
import { UserAvatar } from "../components/UserAvatar";
import { SettingsGroup, SettingsPage, SettingsRow, StatusPill } from "../components/settings";
import { readLinkedProviders } from "../services/accountProviders";
import { driveAuth } from "../services/messaging/driveAuth";
import { updateMyProfile } from "../services/profile";
import { getTelegramAccount } from "../services/telegram";
import { AccountSecuritySections, MobileNumberRow } from "./AccountSettings";
import {
  fetchReputationTier,
  REPUTATION_TIER_LABELS,
  type ReputationTier,
} from "../services/trust";
import "./Profile.css";

/** Account-scoped async state: a previous account's answer is never shown. */
type AccountState<T> =
  | { accountId: string; status: "loading" }
  | { accountId: string; status: "ready"; value: T }
  | { accountId: string; status: "unavailable" };

function scoped<T>(state: AccountState<T>, userId: string | undefined): AccountState<T> {
  return state.accountId === (userId ?? "") ? state : { accountId: userId ?? "", status: "loading" };
}

/**
 * Own-profile reputation. The tier is a SERVER-owned label (NEW / NORMAL /
 * TRUSTED): this reads it and never derives, averages or caches a score.
 */
function useOwnReputation(userId: string | undefined) {
  const [state, setState] = useState<
    { accountId: string; status: "loading" } | { accountId: string; status: "ready"; tier: ReputationTier } | { accountId: string; status: "unavailable" }
  >({ accountId: userId ?? "", status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const accountId = userId ?? "";
    if (!accountId) return;
    setState({ accountId, status: "loading" });
    void fetchReputationTier(accountId)
      .then((tier) => {
        if (!cancelled) setState({ accountId, status: "ready", tier });
      })
      .catch(() => {
        if (!cancelled) setState({ accountId, status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return state.accountId === (userId ?? "") ? state : { accountId: userId ?? "", status: "loading" as const };
}

/** Sign-in providers linked to this account, from its own session snapshot. */
function useLinkedProviders(userId: string | undefined) {
  const [state, setState] = useState<AccountState<ReadonlySet<string>>>({
    accountId: userId ?? "",
    status: "loading",
  });
  useEffect(() => {
    let cancelled = false;
    const accountId = userId ?? "";
    if (!accountId) return;
    setState({ accountId, status: "loading" });
    void readLinkedProviders().then((providers) => {
      if (cancelled) return;
      setState(providers
        ? { accountId, status: "ready", value: providers }
        : { accountId, status: "unavailable" });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return scoped(state, userId);
}

interface TelegramLink {
  linked: boolean;
  handle: string | null;
}

function useTelegramLink(userId: string | undefined) {
  const [state, setState] = useState<AccountState<TelegramLink>>({
    accountId: userId ?? "",
    status: "loading",
  });
  useEffect(() => {
    let cancelled = false;
    const accountId = userId ?? "";
    if (!accountId) return;
    setState({ accountId, status: "loading" });
    void getTelegramAccount().then(
      (account) => {
        if (!cancelled) {
          setState({
            accountId,
            status: "ready",
            value: { linked: account.linked, handle: account.username },
          });
        }
      },
      () => {
        if (!cancelled) setState({ accountId, status: "unavailable" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);
  return scoped(state, userId);
}

interface DriveAccess {
  available: boolean;
  connected: boolean;
}

/** Local Drive grant state. Reading a token is not a network call. */
function useDriveAccess(userId: string | undefined) {
  const [state, setState] = useState<{ accountId: string; value: DriveAccess } | null>(null);
  useEffect(() => {
    const accountId = userId ?? "";
    if (!accountId) return;
    try {
      const auth = driveAuth();
      setState({ accountId, value: { available: auth.available(), connected: auth.current() !== null } });
    } catch {
      setState({ accountId, value: { available: false, connected: false } });
    }
  }, [userId]);
  return state?.accountId === (userId ?? "") ? state.value : null;
}

/**
 * The account's name, editable in place.
 *
 * The name is the primary identity on this page, so editing it takes one press
 * on the name itself instead of sending the reader to a form with eight fields.
 * The write still goes through the same self-only `update_my_profile` RPC, and
 * the untouched bio/location are sent as they are so a name edit cannot quietly
 * clear another field.
 */
function ProfileName({ user }: { user: PublicUser }) {
  const { setUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user.displayName?.trim() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(user.displayName?.trim() ?? "");
    setEditing(false);
    setError(null);
  }, [user.id, user.displayName]);

  useEffect(() => {
    if (editing) input.current?.focus({ preventScroll: true });
  }, [editing]);

  const shown = user.displayName?.trim() || `@${user.username}`;

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const next = draft.trim();
    if (next === "") {
      setError("Enter a name.");
      return;
    }
    if (next.length > 80) {
      setError("Use 80 characters or fewer.");
      return;
    }
    if (next === (user.displayName ?? "").trim()) {
      setEditing(false);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const profile = await updateMyProfile({
        displayName: next,
        bio: user.bio ?? "",
        locationLabel: user.locationLabel ?? "",
      });
      // A late answer for a previous account must not become this one's name.
      if (profile.id !== user.id) return;
      setUser(profile);
      setEditing(false);
      announce("Name updated.");
    } catch {
      setError("Could not save your name. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="fb-profile-name-row">
        <h2 className="fb-profile-name">{shown}</h2>
        <button
          type="button"
          className="fb-profile-name-edit"
          aria-label="Edit name"
          onClick={() => {
            setDraft(user.displayName ?? "");
            setError(null);
            setEditing(true);
          }}
        >
          <Pencil size={15} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <form className="fb-profile-name-form" onSubmit={(event) => void save(event)} noValidate>
      <div className="fb-profile-name-field">
        <input
          ref={input}
          value={draft}
          maxLength={80}
          aria-label="Your name"
          autoComplete="name"
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="fb-profile-name-save" aria-label="Save name" disabled={busy}>
          <Check size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="fb-profile-name-cancel"
          aria-label="Cancel name edit"
          disabled={busy}
          onClick={() => {
            setDraft(user.displayName ?? "");
            setError(null);
            setEditing(false);
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {error && <p className="fb-profile-name-error" role="alert">{error}</p>}
    </form>
  );
}

/** The handle, copyable on press. Hover is an affordance, never the only way. */
function UsernameCopy({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async (): Promise<void> => {
    try {
      if (!navigator.clipboard) throw new Error("unavailable");
      await navigator.clipboard.writeText(`@${username}`);
      setCopied(true);
      announce("Username copied.");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      announce("Could not copy your username.");
    }
  };

  return (
    <button
      type="button"
      className="fb-profile-handle"
      title="Copy username"
      aria-label={`Copy username @${username}`}
      onClick={() => void copy()}
    >
      <span aria-hidden="true">@{username}</span>
      <Copy size={13} aria-hidden="true" />
      <span className="fb-profile-handle-status" aria-hidden="true">{copied ? "Copied" : ""}</span>
    </button>
  );
}

function VerificationChip({
  verified,
  label,
  actionLabel,
  to,
}: {
  verified: boolean;
  label: string;
  actionLabel: string;
  to: string;
}) {
  if (verified) {
    return (
      <span className="fb-profile-chip fb-profile-chip--ok">
        <CircleCheck size={14} aria-hidden="true" />
        {label}
      </span>
    );
  }
  return (
    <Link className="fb-profile-chip fb-profile-chip--action" to={to}>
      <CircleAlert size={14} aria-hidden="true" />
      {actionLabel}
    </Link>
  );
}

/**
 * Profile landing: who you are, what is connected to the account, and the
 * places the account can take you.
 *
 * Owner direction 2026-11-14 (references: the enlarged-photo profile headers):
 * the photo is the centre of the page with its own edit control, the name is
 * large and editable in place, the handle copies on press, and verification is
 * a pair of chips rather than a paragraph. Connected accounts and Drive access
 * sit directly under the identity so the reader can see what the account holds
 * before navigating away. Sign-in and account controls are on the same screen.
 *
 * Profile stays the ONE canonical trust surface: the reputation label and the
 * way into ratings live here, not scattered onto every card.
 */
export function Profile() {
  const { user } = useAuth();
  const reputation = useOwnReputation(user?.id);
  const providers = useLinkedProviders(user?.id);
  const telegram = useTelegramLink(user?.id);
  const drive = useDriveAccess(user?.id);
  if (!user) return null;

  const googleLinked = providers.status === "ready" && providers.value.has("google");
  const googleValue = providers.status === "loading"
    ? "Checking…"
    : providers.status === "unavailable"
      ? "Could not check"
      : googleLinked
        ? <StatusPill tone="success"><Check size={12} aria-hidden="true" /> Connected</StatusPill>
        : "Not linked";
  const googleDescription = providers.status === "unavailable"
    ? "Linked sign-in methods could not be read on this device."
    : googleLinked
      ? "Google is linked, so you can sign in with it."
      : "This account signs in with email and password.";

  const telegramValue = telegram.status === "loading"
    ? "Checking…"
    : telegram.status === "unavailable"
      ? "Could not check"
      : telegram.value.linked
        ? telegram.value.handle ? `@${telegram.value.handle}` : "Connected"
        : "Not connected";

  const driveValue = drive === null
    ? "Checking…"
    : !drive.available
      ? "Unavailable"
      : drive.connected
        ? <StatusPill tone="success"><Check size={12} aria-hidden="true" /> Connected</StatusPill>
        : "Not connected";
  const driveDescription = drive === null
    ? "Checking Drive access…"
    : !drive.available
      ? "Drive backup is not set up in this build."
      : drive.connected
        ? "Encrypted chat backups go to your own Google Drive."
        : "Keep your chats by connecting your own Google Drive.";

  return (
    <SettingsPage title="Profile" backTo="/settings" backLabel="Back to Settings" className="fb-profile">
      <div className="fb-profile-overview">
      <section aria-label="Your identity" className="fb-profile-hero">
        <div className="fb-profile-portrait">
          <UserAvatar avatarUrl={user.avatarUrl} username={user.username} size={104} />
          <Link to="/profile/edit" aria-label="Change profile photo" className="fb-profile-portrait-edit">
            <Camera size={16} aria-hidden="true" />
          </Link>
        </div>
        <ProfileName user={user} />
        <UsernameCopy username={user.username} />
        <div className="fb-profile-chips">
          <VerificationChip
            verified={user.emailVerified}
            label="Email verified"
            actionLabel="Verify email"
            to="/verify"
          />
          <VerificationChip
            verified={user.phoneVerified}
            label="Mobile verified"
            actionLabel={user.phone ? "Verify mobile" : "Add mobile"}
            to="/profile/edit"
          />
        </div>
      </section>

      <div className="fb-profile-groups">
        <SettingsGroup title="Connected accounts">
          <SettingsRow
            title="Google"
            icon={Globe}
            description={googleDescription}
            value={googleValue}
          />
          <SettingsRow
            title="Email"
            icon={Mail}
            value={user.email}
            badge={user.emailVerified ? <StatusPill tone="success">Verified</StatusPill> : undefined}
            route={user.emailVerified ? undefined : "/verify"}
          />
          <MobileNumberRow />
          <SettingsRow
            title="Telegram"
            icon={Send}
            value={telegramValue}
          />
        </SettingsGroup>

        <SettingsGroup title="Drive access">
          <SettingsRow
            title="Chat backup"
            icon={CloudUpload}
            iconTone="blue"
            description={driveDescription}
            value={driveValue}
            route="/settings/backup"
          />
        </SettingsGroup>

      </div>
      </div>

      <section aria-label="Reputation" className="fb-profile-reputation">
        {reputation.status === "loading" && (
          <span role="status" className="fb-profile-reputation-note">Checking your reputation…</span>
        )}
        {reputation.status === "unavailable" && (
          <span role="status" className="fb-profile-reputation-note">Your reputation is unavailable right now.</span>
        )}
        {reputation.status === "ready" && (
          <>
            <StatusPill tone={reputation.tier === "TRUSTED" ? "success" : reputation.tier === "NORMAL" ? "accent" : "neutral"}>
              {REPUTATION_TIER_LABELS[reputation.tier]}
            </StatusPill>
            <span className="fb-profile-reputation-label">Reputation</span>
            <span className="fb-profile-reputation-note">From returned items and ratings</span>
          </>
        )}
      </section>

      <div className="fb-profile-groups">
        <AccountSecuritySections />
        <SettingsGroup title="Devices">
          <SettingsRow
            title="Devices"
            icon={MonitorSmartphone}
            description="Phones, tablets and browsers signed in to Chat."
            route="/settings/devices"
          />
        </SettingsGroup>
      </div>

      <nav aria-label="Profile actions" className="fb-profile-actions">
        <SettingsGroup title="Activity">
          <SettingsRow title="My reports" icon={FileStack} route="/my" />
          <SettingsRow title="Saved reports" icon={Bookmark} route="/saved" />
          <SettingsRow title="Chats" icon={MessagesSquare} route="/chats" />
          <SettingsRow title="Ratings & recoveries" icon={Star} iconTone="amber" route="/settings/returns" />
        </SettingsGroup>
        <SettingsGroup title="More">
          <SettingsRow title="Public profile" icon={UserRound} iconTone="blue" route={`/u/${user.username}`} />
          <SettingsRow title="Settings" icon={SettingsIcon} route="/settings" />
          <SettingsRow title="Help & guide" icon={HelpCircle} iconTone="help" route="/settings/help" />
        </SettingsGroup>
      </nav>
    </SettingsPage>
  );
}
