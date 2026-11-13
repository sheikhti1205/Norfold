import type { ReactNode } from "react";
import "./ReportViewerLayout.css";

export interface ReportViewerLayoutProps {
  /**
   * The report reads as one article: title, byline, photo, body, facts, then
   * what can be done with it. The title is deliberately the first node so the
   * surface opens on the report's own headline rather than on a generic bar.
   */
  media?: ReactNode;
  title: ReactNode;
  identity: ReactNode;
  description: ReactNode;
  meta: ReactNode;
  /** Opposite-type reports to review: the reason most readers open a report. */
  matches?: ReactNode;
  /** Owner management, rating and overview. */
  reportExtra?: ReactNode;
  feedback?: ReactNode;
  comments: ReactNode;
  actions: ReactNode;
  composer: ReactNode;
  /**
   * Wide windows keep the conversation beside the report. Narrow windows hand
   * it to a floating surface of its own (owned by the screen), so this layout
   * renders the report only and keeps the action row pinned at its foot.
   */
  conversation?: boolean;
  shield?: (content: ReactNode) => ReactNode;
}

export function ReportViewerLayout({
  media, title, identity, description, meta, matches, reportExtra, feedback,
  comments, actions, composer, conversation = true, shield,
}: ReportViewerLayoutProps) {
  return <div className="fb-rv" data-conversation={conversation ? "split" : "popup"}>
    <section className="fb-rv-report" aria-label="Report" data-testid="report-viewer-report-pane">
      {(shield ?? ((content) => content))(<>
        <div className="fb-rv-title" data-testid="report-viewer-title">{title}</div>
        {feedback != null && <div className="fb-rv-feedback">{feedback}</div>}
        {media != null && <div className="fb-rv-media" data-testid="report-viewer-media">{media}</div>}
        <div className="fb-rv-report-content">
          {identity}
          {description}
          {meta}
          {matches}
          {reportExtra}
        </div>
      </>)}
      {!conversation && <div className="fb-rv-inline-actions" data-testid="report-viewer-inline-actions">
        {actions}
      </div>}
    </section>
    {conversation && <section className="fb-rv-conversation" aria-label="Conversation" data-testid="report-viewer-conversation-pane">
      <div className="fb-rv-comments">{comments}</div>
      <div className="fb-rv-footer" data-testid="report-viewer-footer">
        <div className="fb-rv-actions">{actions}</div>
        <div className="fb-rv-composer">{composer}</div>
      </div>
    </section>}
  </div>;
}
