import { createContext, useContext, type ReactNode } from "react";
import { historyDepth } from "./backNavigation";

/**
 * The back depth of the router that is actually rendering this button.
 *
 * `historyDepth()` reads the browser tab's history, which is right for the app
 * router and wrong inside a surface with its own memory history - the settings
 * window. Shared back buttons ask this hook instead, so the window walks its
 * own entries and the app keeps walking the tab's.
 */
const RouterDepthContext = createContext<(() => number) | null>(null);

export function RouterDepthProvider({ depth, children }: {
  depth: () => number;
  children: ReactNode;
}) {
  return <RouterDepthContext.Provider value={depth}>{children}</RouterDepthContext.Provider>;
}

export function useRouterHistoryDepth(): number {
  const depth = useContext(RouterDepthContext);
  return depth ? depth() : historyDepth();
}
