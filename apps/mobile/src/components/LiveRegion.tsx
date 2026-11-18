import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { motionDurations, snackbarVariants } from "./uiMotion";
import "./LiveRegion.css";

const EVENT = "findback:announce";
const QUIET_EVENT = "findback:announce-quietly";

/** Visible toast lifetime before it auto-exits (the announcement persists). */
export const SNACKBAR_AUTO_EXIT_MS = 3000;

/** Announce a meaningful event to screen readers (and any visible toast host). */
export function announce(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: message }));
}

/** Announce a state change without showing a snackbar. */
export function announceQuietly(message: string): void {
  window.dispatchEvent(new CustomEvent<string>(QUIET_EVENT, { detail: message }));
}

/**
 * The one animated snackbar primitive: rise/fade enter, auto-exit, shared by
 * the LiveRegion toast and the back-handler exit toast. Transform/opacity
 * only. With `live` (default) it IS the polite live status; LiveRegion sets
 * `live={false}` because its sr-only region already announces (no doubles).
 *
 * The surface uses the shared elevated shadow and clears the home indicator:
 * a toast that sits under the gesture bar cannot be read.
 */
export function Snackbar({
  open,
  message,
  live = true,
  action,
}: {
  open: boolean;
  message: string;
  live?: boolean;
  /** One reversible decision, never a second action row. */
  action?: ReactNode;
}) {
  const actionable = action !== undefined && action !== null;
  return (
    <AnimatePresence>
      {open && message !== "" && (
        <motion.div
          key="fb-snackbar"
          role={live && !actionable ? "status" : undefined}
          aria-live={live && actionable ? "polite" : undefined}
          aria-hidden={live || actionable ? undefined : true}
          initial="hidden"
          animate="visible"
          exit="hidden"
          variants={snackbarVariants}
          transition={{ duration: motionDurations.fast }}
          className="fb-snackbar pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
        >
          <div
            data-testid="snackbar-message"
            className={`fb-snackbar-pill flex items-center gap-3 rounded-full bg-on-surface px-4 py-2 text-sm text-surface${actionable ? " pointer-events-auto" : ""}`}
          >
            <span>{message}</span>
            {action}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Polite live region. Mount once (in Shell) — screens announce via `announce()`. */
export function LiveRegion({ autoExitMs = SNACKBAR_AUTO_EXIT_MS }: { autoExitMs?: number }) {
  const [message, setMessage] = useState("");
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail ?? "";
      setMessage(text);
      setSnackbarMessage(text);
      setVisible(text !== "");
    };
    const quietHandler = (e: Event) => {
      setMessage((e as CustomEvent<string>).detail ?? "");
    };
    window.addEventListener(EVENT, handler);
    window.addEventListener(QUIET_EVENT, quietHandler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener(QUIET_EVENT, quietHandler);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), autoExitMs);
    return () => window.clearTimeout(timer);
  }, [visible, snackbarMessage, autoExitMs]);

  return (
    <>
      <div
        aria-live="polite"
        role="status"
        data-testid="live-region-announcement"
        className="sr-only"
      >
        {message}
      </div>
      <Snackbar open={visible} message={snackbarMessage} live={false} />
    </>
  );
}
