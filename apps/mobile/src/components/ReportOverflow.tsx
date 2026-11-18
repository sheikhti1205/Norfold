import type { PostItem } from "@norfold/shared";
import { Bookmark, X } from "lucide-react";
import { SafetyActions } from "./SafetyActions";
import { useSavePostAction } from "./SavePostButton";
import type { MenuAction } from "./ActionMenu";

/** Composes existing account-fenced owners; no second saved/report/block state. */
export function ReportOverflow({ post, onHide }: { post: PostItem; onHide?: () => void }) {
  const save = useSavePostAction(post.id, post.title);
  const hide: MenuAction[] = onHide
    ? [{
        id: "hide",
        label: "Hide report",
        icon: <X size={18} aria-hidden="true" />,
        onAction: onHide,
      }]
    : [];
  return <SafetyActions
    content={{ targetType: "POST", targetId: post.id }}
    person={{ userId: post.author.id, name: post.author.displayName || post.author.username }}
    actions={[...hide, { id: "save", label: save.label, disabled: !save.hasAccount,
      icon: <Bookmark size={18} aria-hidden fill={save.saved ? "currentColor" : "none"} />,
      onAction: () => { void save.onAction(); },
    }]}
  />;
}
