import type { PostItem } from "@norfold/shared";
import { BlockedByViewerShield } from "../../components/BlockedByViewerShield";
import { DetailHeroGallery } from "../../components/detail/DetailHeroGallery";
import { PostActionRow } from "../../components/PostActionRow";
import { PostFacts, PostIdentityHeader, PostStatusTitle } from "../../components/PostAnatomy";
import { ReportViewerLayout } from "../../components/ReportViewerLayout";
import { ALL_VARIANTS, FixtureFrame, FixtureSection, type FixtureVariant } from "../FixtureSection";

const basePost: PostItem = {
  id: "fixture-viewer", userId: "fixture-user", type: "LOST",
  author: { id: "fixture-user", username: "fixture", displayName: "Fixture user", avatarUrl: null, emailVerified: false, phoneVerified: false, createdAt: "2026-01-01T00:00:00.000Z" },
  title: "Canvas bag", description: "Fixture description of a lost bag.", category: "Bags & Wallets",
  status: "OPEN", eventDate: "2026-01-01", latitude: null, longitude: null,
  locationLabel: "Library", youtubeUrl: null, attachments: [], likeCount: 0,
  dislikeCount: 0, ratingAvg: null, ratingCount: 0, commentCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

function ViewerCase({ variant }: { variant: FixtureVariant }) {
  const count = variant === "long-content" ? 20 : 0;
  const photoCount = variant === "empty" ? 0 : variant === "long-content" ? 5 : 1;
  const post: PostItem = {
    ...basePost,
    id: `fixture-viewer-${variant}`,
    commentCount: count,
    author: {
      ...basePost.author,
      emailVerified: variant === "normal" || variant === "long-content",
      phoneVerified: variant === "dark" || variant === "long-content",
    },
    ...(variant === "long-content" ? {
      title: "A long fixture title for a canvas bag with a torn pocket, a faded tag, and a strap that wraps around the side",
      description: "Fixture description: a canvas bag with a worn strap and a small tear in the side pocket. ".repeat(8),
    } : {}),
  };
  const images = Array.from({ length: photoCount }, (_, index) => ({ fileUrl: `fixture://viewer/photo-${index + 1}.jpg` }));

  return <ReportViewerLayout
    media={photoCount ? <DetailHeroGallery postId={post.id} title={post.title} images={images} /> : undefined}
    identity={<PostIdentityHeader post={post} />}
    title={<PostStatusTitle post={post} detail />}
    description={<p className="whitespace-pre-wrap break-words">{post.description}</p>}
    meta={<PostFacts post={post} />}
    comments={count === 0
      ? <p className="p-3 text-sm text-on-surface-variant">No comments yet.</p>
      : <ol className="p-3">{Array.from({ length: count }, (_, index) => <li key={index} className="py-2 text-sm">Fixture comment {index + 1}</li>)}</ol>}
    actions={<PostActionRow commentCount={count} slots={{ like: null }} />}
    composer={<div className="p-3 text-sm text-on-surface-variant">Add a comment</div>}
    shield={variant === "error" ? (content) => <BlockedByViewerShield rowId={post.id} blocked>{content}</BlockedByViewerShield> : undefined}
  />;
}

export function ReportViewerFixtures() {
  return <FixtureSection id="report-viewer" title="Report viewer" description="Report and conversation layout across fixture states.">
    {ALL_VARIANTS.map((variant) => <FixtureFrame key={variant} section="report-viewer" variant={variant}>
      <ViewerCase variant={variant} />
    </FixtureFrame>)}
  </FixtureSection>;
}
