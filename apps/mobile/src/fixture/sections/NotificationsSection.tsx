import { NotificationBody } from "../../screens/Notifications";
import type { NotificationItem, NotificationType } from "../../services/notifications";
import { FixtureFrame, FixtureSection } from "../FixtureSection";

const types: NotificationType[] = ["LIKE", "REACTION", "STATUS", "MODERATION", "COMMENT", "MENTION", "DISLIKE", "UNKNOWN"];
const rows: NotificationItem[] = types.map((type, index) => ({
  id: `fixture-${type}`,
  type,
  preview: type === "MENTION" ? "@you I found this near the entrance." : "I found this near the entrance.",
  read: index % 2 === 0,
  createdAt: "2026-11-12T12:00:00Z",
  actorId: type === "STATUS" || type === "MODERATION" ? null : "fixture-actor",
  actorUsername: type === "STATUS" || type === "MODERATION" ? null : "Maya",
  postId: "fixture-report",
  postTitle: "Black canvas backpack",
  commentId: null,
  reactionKind: null,
}));

function Rows({ items }: { items: NotificationItem[] }) {
  return <ul className="fb-notification-list">{items.map(item => <li key={item.id} className="fb-notification-row"><div className="fb-notification-body"><NotificationBody item={item} /></div></li>)}</ul>;
}

export function NotificationsSection() {
  return <FixtureSection id="notifications" title="Notifications" description="Notification rows and states.">
    <FixtureFrame section="notifications" variant="normal"><Rows items={rows} /><h3>Unread</h3><Rows items={rows.filter(item => !item.read)} /></FixtureFrame>
    <FixtureFrame section="notifications" variant="empty"><p>No notifications</p><p>No unread notifications</p></FixtureFrame>
    <FixtureFrame section="notifications" variant="error"><p>Could not load notifications</p></FixtureFrame>
    <FixtureFrame section="notifications" variant="dark"><Rows items={rows} /></FixtureFrame>
    <FixtureFrame section="notifications" variant="amoled"><Rows items={rows} /></FixtureFrame>
    <FixtureFrame section="notifications" variant="small-width"><Rows items={rows} /></FixtureFrame>
    <FixtureFrame section="notifications" variant="large-text"><Rows items={rows} /></FixtureFrame>
  </FixtureSection>;
}
