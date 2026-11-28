import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject, type TextareaHTMLAttributes } from "react";
import { SendHorizonal } from "lucide-react";
import { hasFinePointer } from "./inputCapabilities";
import { useHoverLabel } from "./HoverLabel";
import "./adaptiveFoundation.css";

export interface ComposerShellProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  inputLabel: string;
  placeholder?: string;
  disabled?: boolean;
  busy?: boolean;
  /** Explicit true supports attachment-only sends; domain owner validates them. */
  canSend?: boolean;
  /** Fine-pointer desktop default; touch keeps newline. Never inferred from width. */
  enterSends?: boolean;
  context?: ReactNode;
  attachments?: ReactNode;
  actions?: ReactNode;
  /** Controls between the field and Send (the picker toggle keeps its slot there). */
  trailing?: ReactNode;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  inputOverlay?: ReactNode;
  sendLabel?: string;
  sendTestId?: string;
  inputProps?: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "disabled" | "aria-label" | "placeholder">;
  /**
   * A pane docked under the row, inside this form: the expression picker takes
   * the band the keyboard would use. Absent means no element at all, so nothing
   * about the row's layout changes.
   */
  panel?: ReactNode;
}

/**
 * Layout and editing only. Uploads, account fencing, drafts and transport stay
 * with callers.
 *
 * The field is never `disabled`. A disabled textarea loses focus and, on a
 * phone, tears down the keyboard: you send a comment and the place you were
 * typing stops taking input. `readOnly`
 * carries the "this account cannot write" state instead, and Send is the only
 * control that ever goes unavailable. On top of that, a send started from the
 * focused field puts focus back when the send settles, so a slow admission
 * cannot leave the caret somewhere else.
 */
export function ComposerShell({ value, onChange, onSend, inputLabel, placeholder, disabled = false, busy = false,
  canSend = Boolean(value.trim()), enterSends, context, attachments, actions, trailing, inputProps,
  inputRef, inputOverlay, sendLabel = "Send", sendTestId, panel }: ComposerShellProps) {
  const localInput = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? localInput;
  const composing = useRef(false);
  const hadFocus = useRef(false);
  const available = canSend && !disabled && !busy;
  const { hoverLabel } = useHoverLabel();
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    const style = getComputedStyle(input.current);
    const cap = Math.min(208, (parseFloat(style.lineHeight) || 24) * 5 +
      (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0));
    if (input.current.scrollHeight > 0) input.current.style.height = `${Math.min(cap, input.current.scrollHeight)}px`;
    input.current.style.overflowY = input.current.scrollHeight > cap ? "auto" : "hidden";
  }, [value, input]);
  useEffect(() => {
    if (busy || !hadFocus.current) return;
    hadFocus.current = false;
    const element = input.current;
    if (element && document.activeElement !== element) element.focus();
  }, [busy, input]);
  const send = () => {
    if (!available || composing.current) return;
    hadFocus.current = document.activeElement === input.current;
    onSend();
  };
  return <form className="fb-composer-shell" onSubmit={(event) => { event.preventDefault(); send(); }} aria-busy={busy || undefined}>
    {context && <div className="fb-composer-context">{context}</div>}
    {attachments && <div className="fb-composer-attachments">{attachments}</div>}
    <div className="fb-composer-row">
      {actions && <div className="fb-composer-actions">{actions}</div>}
      <div className="fb-composer-field">
      <textarea {...inputProps} ref={input} value={value} aria-label={inputLabel} placeholder={placeholder}
        readOnly={disabled} aria-disabled={disabled || undefined} rows={1}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={(event) => { composing.current = true; inputProps?.onCompositionStart?.(event); }}
        onCompositionEnd={(event) => { composing.current = false; inputProps?.onCompositionEnd?.(event); }}
        onKeyDown={(event) => {
          inputProps?.onKeyDown?.(event);
          if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
          const sends = enterSends ?? hasFinePointer();
          if (sends) { event.preventDefault(); if (!event.repeat) send(); }
        }} />
      {inputOverlay}
      </div>
      {trailing && <div className="fb-composer-trailing">{trailing}</div>}
      <button type="submit" aria-label={sendLabel} data-testid={sendTestId} disabled={!available} className="fb-icon-control fb-composer-send"
        {...hoverLabel(sendLabel)}
        onMouseDown={(event) => {
          // Android dispatches compatibility mouse events for a tap. Keep the
          // editor's existing focus before submit; refocusing after an awaited
          // admission is too late to keep the IME open. Keyboard users still
          // focus/activate the real button normally.
          if (event.button === 0 && document.activeElement === input.current) event.preventDefault();
        }}>
        <SendHorizonal size={20} aria-hidden="true" />
      </button>
    </div>
    {panel}
  </form>;
}
