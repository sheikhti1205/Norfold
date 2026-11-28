import { useEffect, useId, useState, type ReactNode } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { X } from "lucide-react";
import { useKeyboardInset } from "../hooks/keyboardInset";
import { subscribeNativeIme } from "../native/ime";
import { useHoverLabel } from "./HoverLabel";
import { OverlayDepthProvider, OverlayStackBridge, useOverlayDepth } from "./overlayFoundation";

interface SurfaceProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  width?: "standard" | "compact" | "report" | "comments";
  bodyClassName?: string;
  /**
   * Take the whole phone screen. Phone task dialogs are cards by default; only
   * a surface whose content a card would make unusable (a live viewfinder)
   * opts in, and it is the only full-bleed rule left. Inert on desktop.
   */
  immersive?: boolean;
  /**
   * The report owns its headline: the report's title is the first thing the
   * reader sees, so a generic bar above it would be a second title. The bar is
   * dropped and the close control floats over the content instead. The dialog
   * keeps the same accessible name through `aria-label`, so "Report" is still
   * announced and every `role="dialog"` query keeps working.
   */
  headerless?: boolean;
}

function panelClass(width: SurfaceProps["width"], confirmation: boolean) {
  if (confirmation) return "fb-confirm-panel";
  if (width === "compact") return "fb-compact-panel";
  if (width === "report") return "fb-report-panel";
  if (width === "comments") return "fb-comments-panel";
  return "fb-task-panel";
}

/**
 * Whether the shell reports the soft keyboard as visible.
 *
 * This reuses the editor's existing channel (`src/native/ime.ts`) instead of
 * deriving a second one: the Android shell resizes its window with the IME, so
 * layout and visual heights are equal and no viewport geometry can tell the
 * keyboard apart from a short screen. `known: false` (a browser, iOS, or an
 * older shell) is not guessed at — the marker simply stays off. Only the open
 * docked comments sheet subscribes, so every other overlay reads nothing.
 */
function useNativeImeOpen(enabled: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    return subscribeNativeIme((state) => setVisible(state.known && state.visible));
  }, [enabled]);
  return enabled && visible;
}

function DialogSurface({ open, onClose, title, description, children, footer, busy = false, confirmation = false, width = "standard", bodyClassName, headerless = false, immersive = false }: SurfaceProps & { confirmation?: boolean }) {
  const depth = useOverlayDepth();
  const descriptionId = useId();
  const viewport = useKeyboardInset();
  const imeOpen = useNativeImeOpen(width === "comments" && open);
  const { hoverLabel } = useHoverLabel();
  return <ModalOverlay isOpen={open} onOpenChange={(value) => { if (!value && !busy) onClose(); }}
    isDismissable={!confirmation && !busy} isKeyboardDismissDisabled
    className="fb-modal-backdrop" style={{
      zIndex: 70 + depth * 10,
      height: viewport.viewportHeightPx || undefined,
      top: Math.max(0, window.innerHeight - viewport.insetPx - viewport.viewportHeightPx),
      bottom: "auto",
    }}>
    <Modal className={`fb-modal-panel ${panelClass(width, confirmation)}`} data-immersive={immersive ? "true" : undefined} data-ime={imeOpen ? "open" : undefined}>
      <OverlayDepthProvider depth={depth}>
        <OverlayStackBridge onClose={onClose} dismissible={!busy} />
        <Dialog role={confirmation ? "alertdialog" : "dialog"}
          aria-label={headerless ? title : undefined}
          aria-describedby={description ? descriptionId : undefined}
          aria-busy={busy || undefined} className="fb-surface-dialog">
          {headerless ? (
            /* Explicit child focus avoids useDialog's delayed dialog refocus
               racing nested-viewer restoration when a task is opened quickly. */
            <Button autoFocus aria-label="Close" isDisabled={busy} onPress={onClose} className="fb-floating-close" {...hoverLabel("Close")}>
              <X size={20} aria-hidden="true" />
            </Button>
          ) : (
            <header className="fb-surface-header">
              <Heading slot="title" className="fb-surface-title">{title}</Heading>
              {/* Same explicit focus as the headerless close control. */}
              {!confirmation && <Button autoFocus aria-label="Close" isDisabled={busy} onPress={onClose} className="fb-icon-control" {...hoverLabel("Close")}>
                <X size={20} aria-hidden="true" />
              </Button>}
            </header>
          )}
          <div className={bodyClassName ? `fb-surface-body ${bodyClassName}` : "fb-surface-body"} onFocus={(event) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable='true']")) target.scrollIntoView?.({ block: "nearest" });
          }}>
            {description && <p id={descriptionId} className="fb-surface-description">{description}</p>}
            {children}
          </div>
          {footer && <footer className="fb-surface-footer">{footer}</footer>}
        </Dialog>
      </OverlayDepthProvider>
    </Modal>
  </ModalOverlay>;
}

/** Real compact task, centered readable dialog when the window has room. */
export function AdaptiveTaskSurface(props: SurfaceProps) { return <DialogSurface {...props} />; }

/** Caller owns async state/errors. Clicking Confirm never silently closes a failed operation. */
export function ConfirmDialog({ confirmLabel, onConfirm, confirmDisabled = false, cancelLabel = "Cancel", destructive = true, children, ...props }: Omit<SurfaceProps, "children" | "footer"> & {
  confirmLabel: string;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  cancelLabel?: string;
  destructive?: boolean;
  children?: ReactNode;
}) {
  return <DialogSurface {...props} confirmation footer={<>
    <Button autoFocus isDisabled={props.busy} onPress={props.onClose} className="fb-surface-button">{cancelLabel}</Button>
    <Button isDisabled={props.busy || confirmDisabled} onPress={onConfirm} className={`fb-surface-button ${destructive ? "fb-confirm-danger" : "fb-confirm-primary"}`}>{confirmLabel}</Button>
  </>}>{children}</DialogSurface>;
}
