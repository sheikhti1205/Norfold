import { useEffect, useRef, useState, type FormEvent } from "react";
import { normalizePhone } from "@norfold/shared";
import { useAuth } from "../auth";
import { sendPhoneChangeCode, verifyPhoneChangeCode } from "../services/auth";
import { ApiError } from "../services/session";
import { updateMyProfile } from "../services/profile";
import { announce } from "../components/LiveRegion";
import { Button } from "../components/Button";
import { TextField } from "../components/Fields";
import { ProfileAvatarEditor } from "../components/ProfileAvatarEditor";
import { OtpField } from "../components/auth/OtpField";
import { useOtpCountdown } from "../components/auth/useOtpCountdown";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  StatusPill,
} from "../components/settings";
import { friendlyError } from "../utils/friendlyErrors";

const MAX_DISPLAY_NAME = 80;
const MAX_BIO = 280;
const MAX_LOCATION = 60;

/** Auth's ApiErrors are already written for a person; anything else is mapped. */
function phoneErrorCopy(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return friendlyError(error).message;
}

/**
 * Profile editor (compat route `/profile/edit` stays valid; back link goes to
 * the Profile hub, which owns identity).
 *
 * The editable surface is deliberately narrow. The backend `public.users` table
 * grants clients NO INSERT/UPDATE/DELETE (rows are trigger/RPC-owned — see
 * migration 20260920000000_users_privacy_convergence), so:
 * - username: read-only (fixed at signup by the provisioning trigger),
 *   rendered as information — never an editable-looking input.
 * - email: read-only (no email-change flow ships in this build), rendered as
 *   information. Unsupported actions/statuses are omitted, not warned about.
 * - display name / bio / location: editable public identity, written through
 *   the self-only `update_my_profile` RPC (migration 20261009020000).
 * - profile photo: edited through the avatar service (canonical media pipeline
 *   → `avatars/{uid}/…` Storage prefix → self-only `update_my_avatar` RPC).
 * - mobile: CHANGED ONLY AFTER A VERIFICATION CODE. The editor sends an SMS to
 *   the number the reader typed, then confirms that code with
 *   `verifyPhoneChangeCode`; the old write-without-proof path is no longer
 *   reachable from here. The server's replacement gate runs before the SMS.
 */
export function ProfileEdit() {
  const { user } = useAuth();
  const [savedFor, setSavedFor] = useState<string | null>(null);
  if (!user) return null;
  const identity = `${user.id}:${user.phone}`;
  return (
    <SettingsPage title="Edit profile" backTo="/profile" backLabel="Back to Profile">
      <SettingsGroup title="Account information">
        <SettingsRow
          title="Username"
          description="Fixed when your account was created."
          value={`@${user.username}`}
        />
        <SettingsRow title="Email" value={user.email} />
      </SettingsGroup>

      <ProfileAvatarEditor />

      <ProfileIdentityEditor key={user.id} />

      <ProfilePhoneEditor
        key={identity}
        initialSaved={savedFor === identity}
        onSaved={(phone) => setSavedFor(`${user.id}:${phone}`)}
      />
    </SettingsPage>
  );
}

function ProfileIdentityEditor() {
  const { user, setUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [location, setLocation] = useState(user?.locationLabel ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  if (!user) return null;
  const currentUserId = user.id;

  const trimmedName = displayName.trim();
  const bioLength = bio.trim().length;
  const locationLength = location.trim().length;
  const bioTooLong = bioLength > MAX_BIO;
  const locationTooLong = locationLength > MAX_LOCATION;
  const unchanged =
    trimmedName === (user.displayName ?? "").trim() &&
    bio.trim() === (user.bio ?? "").trim() &&
    location.trim() === (user.locationLabel ?? "").trim();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setSaveError(null);
    setSaved(false);
    if (!trimmedName) {
      setNameError("Enter a display name.");
      return;
    }
    if (trimmedName.length > MAX_DISPLAY_NAME) {
      setNameError(`Display name must be ${MAX_DISPLAY_NAME} characters or fewer.`);
      return;
    }
    setNameError(null);
    setSaving(true);
    busy.current = true;
    try {
      const profile = await updateMyProfile({
        displayName: trimmedName,
        bio,
        locationLabel: location,
      });
      if (!alive.current || profile.id !== currentUserId) return;
      setUser(profile);
      setDisplayName(profile.displayName ?? "");
      setBio(profile.bio ?? "");
      setLocation(profile.locationLabel ?? "");
      setSaved(true);
    } catch {
      if (!alive.current) return;
      setSaveError("Could not save your profile. Check your connection and try again.");
    } finally {
      busy.current = false;
      if (alive.current) setSaving(false);
    }
  }

  return (
    <SettingsGroup title="About you">
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => void onSubmit(e)}
        noValidate
      >
        {saveError && (
          <p
            className="rounded-m3-sm border border-error px-3 py-2 text-sm text-error"
            role="alert"
          >
            {saveError}
          </p>
        )}
        {saved && (
          <p
            className="rounded-m3-sm border border-outline-variant px-3 py-2 text-sm text-on-surface"
            role="status"
          >
            Profile saved.
          </p>
        )}

        <TextField
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={MAX_DISPLAY_NAME}
          required
          disabled={saving}
          error={nameError ?? undefined}
        />

        <div>
          <TextField
            label="Bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={MAX_BIO}
            disabled={saving}
            error={bioTooLong ? `Bio must be ${MAX_BIO} characters or fewer.` : undefined}
          />
          <p
            className={`mt-1 text-xs ${bioTooLong ? "text-error" : "text-on-surface-variant"}`}
            aria-live="polite"
          >
            {bioLength}/{MAX_BIO}
          </p>
        </div>

        <TextField
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={MAX_LOCATION}
          placeholder="e.g. Dhaka"
          disabled={saving}
          error={locationTooLong ? `Location must be ${MAX_LOCATION} characters or fewer.` : undefined}
        />

        <Button
          type="submit"
          size="lg"
          loading={saving}
          disabled={unchanged || bioTooLong || locationTooLong}
        >
          Save profile
        </Button>
      </form>
    </SettingsGroup>
  );
}

/**
 * Mobile number: two steps, always.
 *
 * 1. The reader types the number and asks for a code. `sendPhoneChangeCode`
 *    runs the server's replacement gate first, then has Auth send the SMS.
 * 2. The code is confirmed with `verifyPhoneChangeCode`; only then does the
 *    stored number change and the verified badge appear.
 *
 * There is no path here that writes a number without proof. Editing the number
 * while a code is pending is refused by the disabled field plus an explicit
 * "Change number" reset, so a code can never be verified against a destination
 * the server did not send it to.
 */
function ProfilePhoneEditor({ initialSaved, onSaved }: { initialSaved: boolean; onSaved: (phone: string) => void }) {
  const { user, setUser } = useAuth();
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialSaved ? "Mobile number verified." : null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  const { seconds: resendIn, setSeconds: setResendIn } = useOtpCountdown();
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  if (!user) return null;

  const normalized = normalizePhone(phone);
  const current = normalizePhone(user.phone);
  const alreadyVerified = current !== null && normalized === current && user.phoneVerified;
  const pending = sentTo !== null;

  const resetToEditing = (): void => {
    setSentTo(null);
    setCode("");
    setError(null);
    setNotice(null);
  };

  async function sendCode(resend: boolean) {
    if (busy.current || (resend && resendIn > 0)) return;
    const destination = sentTo ?? normalized;
    if (!destination) {
      setError("Enter a valid Bangladesh mobile number (e.g., 01812345678).");
      return;
    }
    if (!resend && alreadyVerified) {
      setError("This number is already verified.");
      return;
    }
    busy.current = true;
    setError(null);
    setNotice(null);
    setSending(true);
    try {
      await sendPhoneChangeCode(user!.id, destination, resend);
      if (!alive.current) return;
      setSentTo(destination);
      setCode("");
      setResendIn(60);
      setNotice(`Code sent to ${destination}. Enter it to confirm the number.`);
    } catch (err) {
      if (!alive.current) return;
      setError(phoneErrorCopy(err));
      if (err instanceof Error && /too many|several codes/i.test(err.message)) setResendIn(60);
    } finally {
      busy.current = false;
      if (alive.current) setSending(false);
    }
  }

  async function verify() {
    const trimmed = code.trim();
    if (busy.current || sentTo === null) return;
    if (!/^\d{6,10}$/.test(trimmed)) {
      setError("Enter the code from the SMS.");
      return;
    }
    busy.current = true;
    setError(null);
    setVerifying(true);
    try {
      const profile = await verifyPhoneChangeCode(user!.id, sentTo, trimmed);
      if (!alive.current || profile.id !== user!.id) return;
      setUser(profile);
      setPhone(profile.phone);
      setSentTo(null);
      setCode("");
      setNotice("Mobile number verified.");
      announce("Mobile number verified.");
      onSaved(profile.phone);
    } catch (err) {
      if (!alive.current) return;
      setError(phoneErrorCopy(err));
      if (err instanceof Error && /too many attempts/i.test(err.message)) setResendIn(60);
    } finally {
      busy.current = false;
      if (alive.current) setVerifying(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (sentTo !== null) void verify();
    else void sendCode(false);
  }

  return (
    <SettingsGroup title="Mobile number">
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={onSubmit}
        noValidate
      >
        <div className="flex flex-wrap items-center gap-2 text-sm text-on-surface-variant">
          <span>Current number</span>
          {user.phone ? (
            <>
              <span className="font-medium text-on-surface">{user.phone}</span>
              <StatusPill tone={user.phoneVerified ? "success" : "neutral"}>
                {user.phoneVerified ? "Verified" : "Not verified"}
              </StatusPill>
            </>
          ) : (
            <span>None linked yet</span>
          )}
        </div>
        <p className="text-sm text-on-surface-variant">
          Changing your number sends a code to the new number. It is saved only after the code is confirmed.
        </p>

        {error && (
          <p role="alert" className="rounded-m3-sm border border-error px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-m3-sm border border-outline-variant px-3 py-2 text-sm text-on-surface">
            {notice}
          </p>
        )}

        <TextField
          label="Mobile (Bangladesh)"
          type="tel"
          value={phone}
          onChange={(e) => {
            if (sentTo !== null) return;
            setPhone(e.target.value);
          }}
          placeholder="01812345678"
          inputMode="numeric"
          autoComplete="tel"
          required
          disabled={sending || verifying || pending}
          error={!normalized && phone.trim() !== "" ? "Enter a valid Bangladesh mobile number (e.g., 01812345678)." : undefined}
        />

        {pending && (
          <OtpField
            label="SMS code"
            value={code}
            onChange={setCode}
            maxLength={10}
            disabled={sending || verifying}
          />
        )}

        <Button
          type="submit"
          size="lg"
          loading={pending ? verifying : sending}
          disabled={pending ? sending : (!normalized || sending || alreadyVerified)}
        >
          {pending ? "Verify number" : "Send code"}
        </Button>

        {pending && (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={sending || verifying || resendIn > 0}
              onClick={() => void sendCode(true)}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </Button>
            <Button
              type="button"
              variant="text"
              disabled={sending || verifying}
              onClick={resetToEditing}
            >
              Change number
            </Button>
          </>
        )}
      </form>
    </SettingsGroup>
  );
}
