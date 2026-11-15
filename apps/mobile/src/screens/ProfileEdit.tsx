import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { updateMyProfile } from "../services/profile";
import { Button } from "../components/Button";
import { TextField } from "../components/Fields";
import { ProfileAvatarEditor } from "../components/ProfileAvatarEditor";
import { TelegramPhoneVerification } from "../components/TelegramPhoneVerification";
import {
  SettingsGroup,
  SettingsPage,
  SettingsRow,
} from "../components/settings";

const MAX_DISPLAY_NAME = 80;
const MAX_BIO = 280;
const MAX_LOCATION = 60;

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
 * - mobile: numbers are NOT edited or proven here. Phone ownership is verified
 *   in Telegram through the reader's own shared contact; Norfold has no SMS
 *   provider. The old typed-number SMS journey is retired.
 */
export function ProfileEdit() {
  const { user } = useAuth();
  if (!user) return null;
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

      <ProfileIdentityEditor key={`${user.id}:identity`} />

      <ProfilePhoneEditor key={`${user.id}:phone`} />
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
 * Mobile number: verified only through Telegram.
 *
 * Norfold has no SMS provider. The reader starts the existing bot link flow and
 * shares their own contact inside Telegram; the server records the number only
 * after that contact is validated. If Telegram is unavailable, the number stays
 * unverified and the copy says so. There is no local or typed-number shortcut.
 */
function ProfilePhoneEditor() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <SettingsGroup title="Mobile number">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-on-surface-variant">
          Norfold does not send text messages. Verify your number by sharing your own contact with the Norfold Telegram bot.
        </p>
        <TelegramPhoneVerification savedPhone={user.phone} />
      </div>
    </SettingsGroup>
  );
}
