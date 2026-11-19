/**
 * Retired host for the old floating message pill.
 *
 * The one unread shortcut now belongs to `ChatDock`: it names the peer from
 * `accountLabels`, renders the canonical `UserAvatar`, and opens the dock
 * instead of navigating. This component stays mounted by the app tree but
 * renders nothing, so a second corner control and a placeholder identity
 * cannot return beside the real launcher.
 */
export function MessagePillHost() {
  return null;
}
