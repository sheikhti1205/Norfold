import { useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth";
import { useMessaging } from "../services/messaging/useMessaging";
import { messagePreview } from "../utils/messagePreview";
import { MessagePill } from "./MessagePill";

const publicPaths = new Set(["/privacy", "/terms", "/community-guidelines", "/auth", "/signin", "/register", "/verify", "/forgot", "/recovery", "/create-password", "/complete-profile", "/onboarding", "/splash", "/__fixture"]);

export function MessagePillHost() {
  const { user, booting, needsProfile } = useAuth();
  const chat = useMessaging();
  const location = useLocation();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<Record<string, Set<string>>>({});
  const openThread = matchPath("/chats/:conversationId", location.pathname);

  if (!user || booting || needsProfile || chat.accountId !== user.id || chat.status !== "ready"
    || publicPaths.has(location.pathname) || matchPath("/shared/:id", location.pathname) || openThread) return null;

  const row = chat.conversations.find((conversation) => {
    const message = conversation.lastMessage;
    const view = chat.currentProjections?.[conversation.conversationId] ?? conversation.cachedProjection;
    return conversation.unreadCount > 0 && message && message.authorId !== user.id
      && message.unsentAt === undefined && !view?.ownHidden && !view?.ownDeclined && !view?.ownBlocked
      && !view?.ownMuted && !dismissed[user.id]?.has(conversation.conversationId);
  });
  if (!row?.lastMessage) return null;

  const message = row.lastMessage;
  const preview = messagePreview(message);
  return <MessagePill person={{ name: "Member", username: "" }} preview={preview}
    onOpen={() => navigate(`/chats/${row.conversationId}`)}
    onDismiss={() => setDismissed((previous) => ({ ...previous,
      [user.id]: new Set([...(previous[user.id] ?? []), row.conversationId]) }))} />;
}
