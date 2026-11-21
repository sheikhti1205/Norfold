import { LayoutGroup } from "framer-motion";
import { PostDetail } from "../screens/PostDetail";
import { AdaptiveTaskSurface } from "./AdaptiveTaskSurface";

/** Same business/content owner as the direct route; no second report implementation. */
export function PostModal({ onClose }: { onClose: () => void }) {
  return <AdaptiveTaskSurface open title="Report" headerless width="report" bodyClassName="fb-rv-body" onClose={onClose}>
    <LayoutGroup id="contextual-report"><PostDetail contextual /></LayoutGroup>
  </AdaptiveTaskSurface>;
}
