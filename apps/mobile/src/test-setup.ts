// Vitest shared setup (apps/mobile). Registered via `test.setupFiles` in
// vite.config.ts.

import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";
import { clearAllConversationDrafts } from "./services/conversationDrafts";

// Unsent chat drafts are module-level memory (they must outlive a component
// unmount), so without a reset one test's typing would pre-fill the next
// render in the same file.
beforeEach(() => { clearAllConversationDrafts(); });

// `waitFor`/`findBy*` default to a 1s polling window. Under full-suite worker
// load that is the flakiest link in the async CreateReport flows, so give it
// the same headroom the suite's own explicit 5s gates already use. This only
// extends patience; it does not relax any assertion.
if (typeof document !== "undefined") {
  configure({ asyncUtilTimeout: 5_000 });
}
