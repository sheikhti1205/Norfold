/**
 * Release notes written for readers.
 *
 * The update catalogue carries machine facts (version, build, artifacts) and a
 * short `summary` written by CI. That summary is a commit subject, so it is
 * never shown as the story of a release. This module owns the reader-facing
 * story instead: what the release is about, what changed, and which capabilities
 * are new.
 *
 * A note is keyed by the exact version the build reports. Versions without a
 * note are shown honestly as having no written notes in this build; nothing
 * falls back to a commit subject or invents a change.
 */
export interface ReleaseFeatureNote {
  /** A capability the reader can now use, in one sentence. */
  summary: string;
  /** A canonical destination id; the route is resolved where it is rendered. */
  destinationId?: string;
}

export interface ReleaseNote {
  versionName: string;
  /** One or two sentences: what this release is about. */
  about: string;
  /** Improvements and fixes a reader can notice. */
  changes: readonly string[];
  /** Capabilities that are new in this release. */
  features: readonly ReleaseFeatureNote[];
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    versionName: "0.16.0-beta.1",
    about:
      "This build rounds out chat, search and navigation, and trims the on-device AI to the two jobs the hardware can run: local search and the sentence model.",
    changes: [
      "On-device chat and photo analysis have been removed. AI chat uses your own provider key, the local search helper and sentence model remain, and files from older downloaded models are found on upgrade and offered for removal.",
      "Downloaded models offer Try again when the device cannot be checked. Unsupported devices are told the helper needs a 64-bit ARM device.",
      "You can rate Norfold once per account and edit your rating later. The server calculates the average, and ratings of other people's reports stay read-only.",
      "Feed updates no longer identify posts on the shared channel. An update about one post reaches only the people who can see that post.",
      "AI chat now separates invalid keys, blocked accounts, exhausted quotas and rate limits. Interrupted answers are marked incomplete, and refusals are not saved as replies.",
      "Message order stays stable after reopening or restoring a device backup. When the backup limit is reached, the app asks you to remove an old backup.",
      "Search retries the operation that failed, describes empty places more accurately, announces which filter a chip clears, and keeps your distance changes while locating.",
      "Photo privacy clears all stripped WebP metadata flags. Animated GIFs keep their animation, and an oversized GIF becomes a still with a note that only sampled frames were seen.",
      "Screen readers announce reaction counts only after your own action changes them.",
      "Shared-report links accept uppercase letters, and Android update versions are ordered correctly for prereleases.",
    ],
    features: [
      { summary: "Send documents, video and audio files in a chat." },
      { summary: "Use emoji, stickers and GIFs in every composer." },
      { summary: "Settings opens in a floating window, with your profile inside it, so the screen you were on stays behind it." },
      { summary: "Desktop navigation uses a pinned side rail and a rebuilt account menu." },
      { summary: "Search is one floating surface with a filter tray and a calendar.", destinationId: "search" },
      { summary: "Insights and Reactions screens sit in the activity area." },
      { summary: "The report viewer is built around the report, and comments have their own surface." },
    ],
  },
  {
    versionName: "0.15.0-beta.1",
    about:
      "The chat update: replies you can jump to, photo albums in one bubble, pinned messages, and a report flow that sends only the excerpts you choose.",
    changes: [
      "The sender's composition time travels with a send, so both people group the same photo batch and see the same clock instead of measuring upload time.",
      "Google sign-in completes in the system browser when the device has no usable credential, then returns to the app through the verified callback.",
      "A reported unsent message keeps one hidden local copy for 24 hours so staff can review it. It is never shown, synced or included in backups, and it is deleted when the window ends.",
    ],
    features: [
      { summary: "Tap a reply's quoted reference to jump to the original and ring it. Reduced motion keeps a static ring." },
      { summary: "Photos sent together appear in one bubble, and tapping any photo opens the shared viewer at that photo." },
      { summary: "Pin up to three messages in a connected conversation. Pin and Unpin sit in the long-press menu." },
      { summary: "Reporting a person sends the five most recent messages by default. You can send fewer or up to twenty, and staff see only the excerpts you selected." },
    ],
  },
  {
    versionName: "0.14.0-beta.1",
    about:
      "The product became Norfold. The logo and the findbackapp.social address stayed the same.",
    changes: [
      "The name, app label, sign-in, help, legal and About copy, and share previews now say Norfold.",
      "The accent named FindBack Blue is now Blue.",
      "Technical identifiers, including the Android application id and stored data, were kept, so existing accounts and reports carry over.",
    ],
    features: [],
  },
  {
    versionName: "0.10.0-beta.1",
    about:
      "This version corrected the version line. An earlier 1.0.0 label promised a stable release that never shipped, so the project returned to the pre-1.0 beta line.",
    changes: [
      "Work from the period labelled 1.0.0 is kept under this corrected beta version. Nothing was removed.",
      "No Android download was published for this version.",
    ],
    features: [],
  },
  {
    versionName: "0.9.0-beta.1",
    about:
      "An earlier beta that refreshed the Help landing, moved to a neutral palette, and closed a round of security work.",
    changes: [
      "Help gained a new landing page.",
      "The palette moved to neutral colours.",
      "A round of security work landed in the same beta.",
      "Archived downloads from this release have not been verified for in-app installation.",
    ],
    features: [],
  },
];

const BY_VERSION = new Map(RELEASE_NOTES.map((note) => [note.versionName, note]));

/** The written notes for one exact version, or null when none exist yet. */
export function releaseNoteFor(versionName: string): ReleaseNote | null {
  return BY_VERSION.get(versionName) ?? null;
}
