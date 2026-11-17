import { useEffect, useRef, useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { useAuth } from "../auth";
import { requestAccountDeletion, sendAccountPasswordCode, saveAccountPasswordWithCode } from "../services/auth";
import { ApiError } from "../services/session";
import { TelegramMark } from "../components/BrandMarks";
import type { TelegramAccountState } from "../hooks/useTelegramAccount";
import { Button } from "../components/Button";
import { useOtpCountdown } from "../components/auth/useOtpCountdown";
import { TelegramSettings } from "../components/settings/TelegramSettings";
import { Profile } from "./Profile";
import {
  SettingsGroup,
  SettingsRow,
  StatusPill,
} from "../components/settings";
import { describeCloudConnections } from "../services/aiCredentials";
import { friendlyError } from "../utils/friendlyErrors";
import "./AccountSettings.css";

/**
 * Password-flow copy: the auth service's ApiError messages are already
 * user-facing (wrong/expired code, send limits, account changed), so they are
 * shown as written instead of being flattened to a generic failure.
 */
function passwordErrorCopy(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return friendlyError(error).message;
}

function passwordRetrySeconds(error: unknown): number {
  if (error instanceof Error && "retryAfterSeconds" in error) {
    const value = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return 60;
}

export function AccountSettings() {
  return <Profile />;
}

/**
 * One compact line for the phone lane. The number and its badge come from the
 * same Telegram read the Profile chip uses, never from the retired typed
 * `users.phone` field: a typed number was never proof of ownership, so showing
 * it here would advertise a verification the account does not have.
 */
export function MobileNumberRow({ account }: { account: TelegramAccountState }) {
  const { user } = useAuth();
  if (!user) return null;
  const verifiedPhone = account.status === "ready" && account.account.linked
    ? account.account.phone
    : null;
  const badge = account.status === "loading"
    ? <StatusPill tone="neutral">Checking…</StatusPill>
    : account.status === "unavailable"
      ? <StatusPill tone="neutral">Could not check</StatusPill>
      : <StatusPill tone={verifiedPhone ? "success" : "neutral"}>{verifiedPhone ? "Verified" : "Not verified"}</StatusPill>;
  return (
    <SettingsRow
      title="Mobile number"
      className="fb-profile-account-row"
      iconNode={<TelegramMark size={16} />}
      value={verifiedPhone ?? undefined}
      badge={badge}
      route="/profile/edit"
    />
  );
}

export function AccountSecuritySections() {
  const { user, logout, finishAccountDeletion, retryDeletionCleanup, hasPassword: passwordPresence, refreshPasswordPresence } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [checkingKeys, setCheckingKeys] = useState(false);
  const [confirmKeyRemoval, setConfirmKeyRemoval] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordConfirmationPending, setPasswordConfirmationPending] = useState(false);
  const [passwordCodeSent, setPasswordCodeSent] = useState(false);
  const [passwordCode, setPasswordCode] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const { seconds: passwordResendIn, setSeconds: setPasswordResendIn } = useOtpCountdown();
  const [localCleanupDone, setLocalCleanupDone] = useState(false);
  const currentAccount = useRef(user?.id ?? null);
  currentAccount.current = user?.id ?? null;
  const accountId = user?.id ?? null;
  useEffect(() => {
    if (accountId === null) return;
    setDeleteArmed(false); setDeleteEmail(""); setDeleteError(null); setDeleting(false);
    setDeleted(false); setLocalCleanupDone(false);
  }, [accountId]);

  // The auth-owned feedback in App survives the protected-route redirect.
  if (deleted) {
    return (
      <div className="fb-profile-security" data-testid="account-security">
        <p role="status" className="fb-account-notice">
          Your account was permanently deleted. {localCleanupDone ? "This device has been signed out and its stored keys removed." : "Finishing sign-out on this device…"}
        </p>
        {deleteError ? <>
          <p role="alert" className="fb-account-error">Your account was deleted, but cleanup on this device did not finish. {deleteError}</p>
          <Button disabled={deleting} onClick={() => {
            setDeleting(true);
            void retryDeletionCleanup().finally(() => setDeleting(false));
          }}>Finish signing out</Button>
        </> : null}
      </div>
    );
  }

  if (!user) return null;
  const userId = user.id;
  // The account's own record is the only honest source for "a password exists":
  // the server's encrypted_password check, never an identity or a metadata
  // marker. `passwordSaved` covers the seconds before the shared authority
  // refreshes after a save on this screen.
  const hasPassword = passwordSaved || passwordPresence === true;
  const passwordDescription = hasPassword
    ? "You can sign in with your email and this password."
    : passwordPresence === false
      ? "Add a password so you can also sign in without Google."
      : "Checking your sign-in methods…";

  function runLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setSignOutError(null);
    void logout()
      .catch((err: unknown) => {
        setSignOutError(friendlyError(err).message);
      })
      .finally(() => setLoggingOut(false));
  }

  function handleSignOut() {
    if (loggingOut || checkingKeys) return;
    // A confirmed notice logs out immediately; the first click only probes
    // credential presence (provider ids, never key material).
    if (confirmKeyRemoval) {
      runLogout();
      return;
    }
    setCheckingKeys(true);
    void describeCloudConnections(userId).then(
      (connections) => {
        const hasStored =
          connections.connected ||
          connections.providers.length > 0 ||
          (connections.summary !== "" && connections.summary !== "Not connected");
        if (hasStored) {
          setConfirmKeyRemoval(true);
        } else {
          runLogout();
        }
      },
      () => {
        // A probe failure must never strand the user signed in; the logout
        // path purges stored keys regardless.
        runLogout();
      },
    ).finally(() => setCheckingKeys(false));
  }

  function cancelSignOut() {
    setConfirmKeyRemoval(false);
    setSignOutError(null);
  }

  /** Confirmed captured-account cleanup is mandatory; only UI follows the slot. */
  function runDeleteAccount() {
    if (deleting || !user) return;
    setDeleting(true);
    setDeleteError(null);
    const deletingAccount = user.id;
    void requestAccountDeletion(deletingAccount)
      .then(async () => {
        if (currentAccount.current === deletingAccount) {
          setDeleted(true);
          setDeleteArmed(false);
        }
        await finishAccountDeletion(deletingAccount);
        if (currentAccount.current !== deletingAccount && currentAccount.current !== null) return;
        setLocalCleanupDone(true);
      })
      .catch((err: unknown) => {
        if (currentAccount.current !== deletingAccount && currentAccount.current !== null) return;
        setDeleteError(friendlyError(err).message);
      })
       .finally(() => { if (currentAccount.current === deletingAccount) setDeleting(false); });
  }

  function cancelDeleteAccount() {
    setDeleteArmed(false);
    setDeleteEmail("");
    setDeleteError(null);
  }

  async function sendPasswordCode() {
    setPasswordBusy(true);
    setPasswordError(null);
    setPasswordMessage(null);
    try {
      await sendAccountPasswordCode(user!.id, user!.email);
      setPasswordCodeSent(true);
      setPasswordCode("");
      setPasswordResendIn(30);
      setPasswordMessage(`We sent a code to ${user!.email}. Enter it to confirm the password.`);
    } catch (error) {
      setPasswordError(passwordErrorCopy(error) || "Couldn’t send the code. Try again.");
      if (error instanceof Error && /too many|several codes/i.test(error.message)) setPasswordResendIn(passwordRetrySeconds(error));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    if (passwordConfirmationPending) {
      setPasswordBusy(true);
      try {
        if (await refreshPasswordPresence()) {
          setPasswordSaved(true);
          setPasswordConfirmationPending(false);
          setPasswordOpen(false);
        } else {
          setPasswordError("Your password was saved, but we couldn't verify it. Try again.");
        }
      } catch {
        setPasswordError("Your password was saved, but we couldn't verify it. Try again.");
      } finally {
        setPasswordBusy(false);
      }
      return;
    }
    if (password.length < 8) { setPasswordError("Use at least 8 characters."); return; }
    if (password !== passwordConfirm) { setPasswordError("The two passwords do not match."); return; }
    if (!passwordCodeSent) {
      await sendPasswordCode();
      return;
    }
    if (!/^\d{6,10}$/.test(passwordCode.trim())) {
      setPasswordError("Enter the code from your email.");
      return;
    }
    setPasswordBusy(true);
    try {
      await saveAccountPasswordWithCode({
        accountId: user!.id,
        email: user!.email,
        password,
        code: passwordCode.trim(),
      });
      const confirmed = await refreshPasswordPresence().catch(() => false);
      if (!confirmed) {
        setPasswordConfirmationPending(true);
        setPasswordError("Your password was saved, but we couldn't verify it. Try again.");
        setPassword("");
        setPasswordConfirm("");
        setPasswordCode("");
        return;
      }
      setPasswordSaved(true);
      setPasswordOpen(false);
      setPasswordCodeSent(false);
      setPasswordCode("");
      setPasswordMessage(null);
      setPassword("");
      setPasswordConfirm("");
    } catch (error) {
      setPasswordError(passwordErrorCopy(error) || "Couldn’t set a password. Try again.");
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="fb-profile-security" data-testid="account-security">
      <SettingsGroup title="Sign-in">
        <SettingsRow
          title="Sign-in password"
          description={passwordDescription}
          value={passwordOpen ? "Close" : hasPassword ? "Change" : passwordPresence === false ? "Add" : "Manage"}
          onClick={() => {
            setPasswordOpen(open => !open);
            setPasswordError(null);
            setPasswordMessage(null);
            setPasswordCodeSent(false);
            setPasswordCode("");
          }}
        />
        {passwordOpen && (
          <form className="fb-account-password" onSubmit={savePassword} noValidate>
            <label htmlFor="fb-account-password">
              New password
              <input
                id="fb-account-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            </label>
            <label htmlFor="fb-account-password-confirm">
              Confirm password
              <input
                id="fb-account-password-confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={passwordConfirm}
                onChange={event => setPasswordConfirm(event.target.value)}
              />
            </label>
            <p className="fb-account-hint">At least 8 characters.</p>
            {passwordCodeSent && (
              <>
                <label htmlFor="fb-account-password-code">
                  Email code
                  <input
                    id="fb-account-password-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={10}
                    required
                    value={passwordCode}
                    onChange={event => setPasswordCode(event.target.value.replace(/\D/g, "").slice(0, 10))}
                  />
                </label>
                <p className="fb-account-hint">Enter the code sent to {user.email}. It expires shortly.</p>
              </>
            )}
            {passwordMessage && <p className="fb-account-hint" role="status">{passwordMessage}</p>}
            {passwordError && <p className="fb-account-error" role="alert">{passwordError}</p>}
            <Button type="submit" loading={passwordBusy}>{passwordConfirmationPending ? "Try again" : passwordCodeSent ? "Verify and save" : "Send code"}</Button>
            {passwordCodeSent && !passwordConfirmationPending && (
              <Button
                type="button"
                variant="outline"
                disabled={passwordBusy || passwordResendIn > 0}
                onClick={() => void sendPasswordCode()}
              >
                {passwordResendIn > 0 ? `Resend in ${passwordResendIn}s` : "Resend code"}
              </Button>
            )}
          </form>
        )}
      </SettingsGroup>

      <TelegramSettings key={userId} />

      <Button
        variant="outline"
        loading={loggingOut || checkingKeys}
        onClick={handleSignOut}
      >
        <LogOut size={16} aria-hidden />
        Log out
      </Button>
      {confirmKeyRemoval ? (
        <div>
          <p role="status" className="fb-account-notice">
            Signing out will remove your stored AI provider keys from this
            device. You will need to enter them again after signing back in.
          </p>
          <div className="fb-account-confirm-row">
            <Button
              variant="outline"
              loading={loggingOut}
              onClick={runLogout}
            >
              Remove keys and log out
            </Button>
            <Button variant="text" disabled={loggingOut} onClick={cancelSignOut}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {signOutError ? (
        <p role="alert" className="fb-account-error">
          {signOutError}
        </p>
      ) : null}

      <SettingsGroup title="Delete account">
        <p className="fb-account-notice">
          Deletes your account, reports and photos. Limited safety records remain
          as described in Privacy. Other people's existing copies cannot be
          erased.
        </p>
        {!deleteArmed ? (
          <Button variant="error" onClick={() => { setDeleteArmed(true); setDeleteError(null); }}>
            Delete account…
          </Button>
        ) : (
          <div>
            <label htmlFor="fb-delete-confirm-email">
              Type your email address ({user.email}) to confirm deletion.
            </label>
            <input
              id="fb-delete-confirm-email"
              type="email"
              autoComplete="off"
              value={deleteEmail}
              disabled={deleting}
              onChange={(event) => setDeleteEmail(event.target.value)}
            />
            <div className="fb-account-confirm-row">
              <Button
                variant="error"
                loading={deleting}
                disabled={deleteEmail.trim().toLowerCase() !== user.email.toLowerCase()}
                onClick={runDeleteAccount}
              >
                Permanently delete my account
              </Button>
              <Button variant="text" disabled={deleting} onClick={cancelDeleteAccount}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </SettingsGroup>
      {deleteError ? (
        <p role="alert" className="fb-account-error">
          {deleteError}
        </p>
      ) : null}
    </div>
  );
}

