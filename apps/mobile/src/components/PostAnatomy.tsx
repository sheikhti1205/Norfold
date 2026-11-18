import type { ReactNode } from "react";
import type { PostItem } from "@norfold/shared";
import { motion } from "framer-motion";
import { BarChart3, MapPin, Tag } from "lucide-react";
import { timeAgo } from "../utils/dates";
import { UserIdentityTrigger } from "./UserIdentityTrigger";
import { VerifiedBadge } from "./VerifiedBadge";
import { StatusChip, StatusBadge, detailStatusBadges } from "./StatusChip";
import { PostLink } from "./PostNavigation";
import { useInfoLabel } from "./HoverLabel";
import { motionDurations, motionEasings, motionSprings } from "./uiMotion";
import "./PostAnatomy.css";

export function sharedMediaLayoutId(postId: string) { return `fb-post-media-${postId}`; }
export function sharedTitleLayoutId(postId: string) { return `fb-post-title-${postId}`; }
export const sharedElementTransition = {
  layout: motionSprings.soft, duration: motionDurations.fast, ease: motionEasings.inOut,
} as const;

/**
 * Category and location are words, not a second text row: each one is a
 * compact control in the author row whose label appears on rest, focus or tap.
 * The row keeps the reader's eye on the title and the photo.
 */
function PostMetaButton({ label, text, icon }: { label: string; text: string; icon: ReactNode }) {
  const { infoLabel } = useInfoLabel();
  return <button type="button" className="fb-icon-control fb-post-meta-icon"
    aria-label={label} {...infoLabel(text)}>
    {icon}
  </button>;
}

export function PostMetaIcons({ post }: { post: PostItem }) {
  return <div data-testid="post-meta" className="fb-post-meta">
    <PostMetaButton label={`Category: ${post.category}`} text={post.category} icon={<Tag size={16} aria-hidden />} />
    {post.locationLabel && <PostMetaButton label={`Location: ${post.locationLabel}`} text={post.locationLabel} icon={<MapPin size={16} aria-hidden />} />}
  </div>;
}

/** Public presentation only; overflow and relationship state stay with features. */
export function PostIdentityHeader({ post, overflow, meta, contextReportId }: {
  post: PostItem; overflow?: ReactNode; meta?: ReactNode; contextReportId?: string;
}) {
  const person = contextReportId ? { ...post.author, contextReportId } : post.author;
  const identity = <UserIdentityTrigger person={person} />;
  return <header className="fb-post-identity">
    <div className="fb-post-identity-line">
      <span className="fb-post-name-badge">{identity}<VerifiedBadge emailVerified={post.author.emailVerified} phoneVerified={post.author.phoneVerified} telegramPhoneVerified={(post.author as { telegramPhoneVerified?: boolean }).telegramPhoneVerified} /></span>
      <span className="fb-post-time"><time data-testid="post-time" dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>{timeAgo(post.createdAt)}</time></span>
    </div>
    {meta}
    {overflow && <div className="fb-post-overflow">{overflow}</div>}
  </header>;
}

/**
 * The views metric that sits in the action row's insights slot.
 *
 * It is information, not a button: no pressed state and no navigation. But it
 * sits between real controls, so it answers the same way they do: the row's
 * hover tint, and the one floating pill naming it ("0 views"). Without that
 * the bar-chart glyph read as an unlabelled, dead button.
 */
export function PostInsightsMetric({ views }: { views: number }) {
  const { infoLabel } = useInfoLabel();
  const label = views === 1 ? "1 view" : `${views} views`;
  return <span
    data-testid="post-views"
    data-action="insights"
    className="fb-report-metric"
    {...infoLabel(label)}
  >
    <BarChart3 size={24} aria-hidden />
    <span className="tabular-nums" aria-hidden>{views}</span>
    <span className="sr-only">{label}</span>
  </span>;
}

/**
 * On the report surface the title IS the heading, and its type and lifecycle
 * state sit directly under it as bordered semantic badges. The feed keeps the
 * single collapsed chip: there the state has to survive a two-line clamp.
 */
export function PostStatusTitle({ post, detail = false, inlineStatus = false, titleClassName = "fb-feed-title", linkTestId, enableSharedMedia = false }: {
  post: PostItem; detail?: boolean; inlineStatus?: boolean; titleClassName?: string; linkTestId?: string; enableSharedMedia?: boolean;
}) {
  const Title = detail ? motion.h1 : motion.h3;
  const title = <Title className={`break-words ${titleClassName}`} {...(enableSharedMedia ? {
    layoutId: sharedTitleLayoutId(post.id), "data-shared-title": sharedTitleLayoutId(post.id), transition: sharedElementTransition,
  } : {})}>{post.title}</Title>;
  return <div className="fb-post-heading">
    {detail ? <>
      <div data-testid="post-title">{title}</div>
      <div className="fb-title-status" data-testid="post-title-status">
        {detailStatusBadges(post).map(({ kind, label }) => <StatusBadge key={kind} kind={kind} label={label} />)}
      </div>
    </> : inlineStatus ? (
      <div className="fb-post-title-row">
        <div data-testid="post-title" className="fb-post-title-main">
          <PostLink to={`/posts/${post.id}`} data-testid={linkTestId} className="fb-post-title-link">{title}</PostLink>
        </div>
        <StatusChip post={post} />
      </div>
    ) : <>
      <div className="fb-post-status"><StatusChip post={post} />{post.status !== "OPEN" && <span>{post.type === "LOST" ? "Lost" : "Found"}</span>}</div>
      <div data-testid="post-title"><PostLink to={`/posts/${post.id}`} data-testid={linkTestId} className="fb-post-title-link">{title}</PostLink></div>
    </>}
  </div>;
}

/** Facts follow media, never a second metadata card. Extra detail is a slot. */
export function PostFacts({ post, children }: { post: PostItem; children?: ReactNode }) {
  return <div className="fb-post-facts">
    {post.locationLabel && <p data-testid="post-location"><MapPin size={13} aria-hidden /><span>{post.locationLabel}</span></p>}
    <p data-testid="post-category"><Tag size={13} aria-hidden /><span>{post.category}</span></p>
    {children}
  </div>;
}
