import type { ReactNode } from "react";
import "./ReportViewerLayout.css";

export interface ReportViewerLayoutProps {
  media?: ReactNode;
  identity: ReactNode;
  title: ReactNode;
  description: ReactNode;
  meta: ReactNode;
  reportExtra?: ReactNode;
  feedback?: ReactNode;
  comments: ReactNode;
  actions: ReactNode;
  composer: ReactNode;
  shield?: (content: ReactNode) => ReactNode;
}

export function ReportViewerLayout({ media, identity, title, description, meta, reportExtra, feedback, comments, actions, composer, shield }: ReportViewerLayoutProps) {
  return <div className="fb-rv">
    <section className="fb-rv-report" aria-label="Report" data-testid="report-viewer-report-pane">
      {(shield ?? ((content) => content))(<>
      {media != null && <div className="fb-rv-media" data-testid="report-viewer-media">{media}</div>}
      <div className="fb-rv-report-content">
        {identity}
        {title}
        {description}
        {meta}
        {reportExtra}
      </div>
      </>)}
    </section>
    <section className="fb-rv-conversation" aria-label="Conversation" data-testid="report-viewer-conversation-pane">
      <div className="fb-rv-comments">{feedback}{comments}</div>
      <div className="fb-rv-footer" data-testid="report-viewer-footer">
        <div className="fb-rv-actions">{actions}</div>
        <div className="fb-rv-composer">{composer}</div>
      </div>
    </section>
  </div>;
}
