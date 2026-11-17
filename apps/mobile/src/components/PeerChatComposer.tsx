import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Camera, ChevronRight, Ellipsis, FileUp, ImagePlus, Mic, SendHorizontal, Square, Sticker } from "lucide-react";
import { hasFinePointer } from "./inputCapabilities";
import { useHoverLabel } from "./HoverLabel";
import { convertEmoticonsLive } from "../utils/emoji";
import { EmojiPickerButton } from "./EmojiPickerButton";
import { KlipyPicker } from "./KlipyPicker";
import { insertEmoji } from "./EmojiPicker";
import { isKlipyEnabled, type KlipyItem } from "../services/klipy";
import "./peerComposer.css";

export interface PeerChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  busy: boolean;
  locked: boolean;
  /** Attachment controls stay disabled while an uncertain admission owns them,
   * even when Send must stay available for an identical retry. */
  attachmentsLocked?: boolean;
  canSend: boolean;
  photoAllowed: boolean;
  onCamera: () => void;
  onPhotos: () => void;
  /** Any non-photo file (document, video, audio file, archive). Classification
   * and refusal live in the screen's file owner, never here. */
  onFiles?: (files: File[]) => void;
  fileSending?: boolean;
  /** Voice is a real capability flag: when false the control explains the
   * limitation instead of pretending to record. */
  voiceAvailable?: boolean;
  /** True while the microphone is actually open; the control then stops it. */
  voiceActive?: boolean;
  onVoice?: () => void;
  /** A picked sticker/GIF. The screen sends it; the composer never guesses
   * how a conversation carries media. */
  onPickKlipy?: (item: KlipyItem) => void;
  context?: ReactNode;
}

/**
 * Human-to-human composer.
 *
 * The row at rest is Camera, Photos, Stickers/GIFs, and an overflow menu; the
 * text field follows; the emoji trigger and Send stay on the far right. The
 * overflow menu holds the less frequent controls (File, Voice) so five 44px
 * controls never squeeze the field.
 *
 * Attachment expansion is explicit state, not `document.activeElement`:
 *   - opening an idle conversation shows the controls;
 *   - focusing/typing in the field collapses them behind `>`;
 *   - `>` slides them back out;
 *   - returning to the field collapses them again;
 *   - a successful send or clearing the whole draft restores them even while
 *     the keyboard is still open.
 *
 * Narrow composers (under 400px of their own width) start collapsed: five
 * 44px controls plus the field at 320dp left the field 66px wide and clipped
 * its own placeholder mid-word. That decision is a container query in
 * `peerComposer.css`, not a measurement in JavaScript, so it cannot race
 * layout; `data-reveal` here only records what the reader asked for. There is
 * no outer capsule: the field keeps its own rounded surface and every other
 * control floats independently.
 *
 * Emoji is the exception: it stays reachable on the right because the owner
 * asked for it while composing, not only before typing (R5).
 */
export function PeerChatComposer({
  value, onChange, onSend, inputRef, busy, locked, canSend, attachmentsLocked = false,
  photoAllowed, onCamera, onPhotos, onFiles, fileSending = false,
  voiceAvailable = false, voiceActive = false, onVoice,
  onPickKlipy, context,
}: PeerChatComposerProps) {
  // `null` means "follow the width" (CSS decides); true/false is what the
  // reader asked for and outranks the width until the draft is cleared.
  const [reveal, setReveal] = useState<boolean | null>(null);
  const [focused, setFocused] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const field = inputRef;
  const fileInput = useRef<HTMLInputElement>(null);
  const moreRoot = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  // Live conversion changes the value, so the caret it produced is restored
  // after React commits instead of being left wherever the browser guessed.
  const caret = useRef<number | null>(null);
  const klipy = isKlipyEnabled() && onPickKlipy !== undefined;
  const attachmentBusy = busy || locked || attachmentsLocked || fileSending;
  const { hoverLabel } = useHoverLabel();

  useLayoutEffect(() => {
    const next = caret.current;
    if (next === null) return;
    caret.current = null;
    const element = field.current;
    if (element && document.activeElement === element) element.setSelectionRange(next, next);
  }, [value, field]);
  const available = canSend && !locked && !busy;

  // Restore on send or on clearing the entire draft — including while the IME
  // is still open. It collapses again only on a deliberate return to the field
  // or on typing new content.
  useEffect(() => {
    if (value === "") setReveal(null);
  }, [value]);

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    const style = getComputedStyle(element);
    const line = parseFloat(style.lineHeight) || 20;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    // Blurred, the field sits at its resting one-line height even when it holds
    // a long draft; focused, it grows to four lines before it scrolls.
    const cap = focused ? Math.min(160, line * 4 + padding) : line + padding;
    if (element.scrollHeight > 0) element.style.height = `${Math.min(cap, element.scrollHeight)}px`;
    element.style.overflowY = focused && element.scrollHeight > cap ? "auto" : "hidden";
  }, [value, field, focused]);

  // Close the overflow menu on an outside press or Escape.
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (moreRoot.current && !moreRoot.current.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [moreOpen]);

  const send = () => { if (available && !composing.current) onSend(); };

  function pickEmoji(glyph: string) {
    const element = field.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const inserted = insertEmoji(value, start, end, glyph);
    caret.current = inserted.caret;
    onChange(inserted.text);
    element?.focus();
  }

  function pickKlipy(item: KlipyItem) {
    setGifOpen(false);
    onPickKlipy?.(item);
  }

  const button = (label: string, icon: ReactNode, action: () => void, disabled = false) => (
    <button type="button" className="fb-peer-icon" aria-label={label}
      disabled={disabled} onClick={action} {...hoverLabel(label)}>
      {icon}
    </button>
  );

  const hasMore = onFiles !== undefined || voiceAvailable;
  const revealState = reveal === null ? "auto" : reveal ? "on" : "off";
  // Typing removes the cluster from the DOM; the width default is left to the
  // container query, so the two states can coexist without guessing.
  const showControls = reveal !== false;
  const showReveal = reveal !== true;

  return <form className="fb-peer-composer" aria-busy={busy || fileSending || undefined}
    onSubmit={(event) => { event.preventDefault(); send(); }}>
    {context}
    <div className="fb-peer-composer-row">
      {/* Both states are always rendered; the container query in
          `peerComposer.css` decides which one is visible, and `data-reveal`
          records a deliberate choice that outranks the width. */}
      <div className="fb-peer-attachments" data-reveal={revealState}>
        {showControls && <div className="fb-peer-controls">
          {button("Take photo", <Camera size={21} aria-hidden="true" />, onCamera, !photoAllowed || attachmentBusy)}
          {button("Choose photo", <ImagePlus size={21} aria-hidden="true" />, onPhotos, !photoAllowed || attachmentBusy)}
          {hasMore && (
            <div className="relative" ref={moreRoot}>
              <button type="button" className="fb-peer-icon" aria-label="More attachments"
                aria-haspopup="menu" aria-expanded={moreOpen}
                disabled={attachmentBusy && !voiceActive}
                onClick={() => setMoreOpen((open) => !open)}
                {...hoverLabel("More attachments")}>
                <Ellipsis size={21} aria-hidden="true" />
              </button>
              {moreOpen && (
                <div className="fb-picker-layer fb-peer-more" data-size="menu" role="menu" aria-label="More attachments">
                  {onFiles && (
                    <button type="button" role="menuitem" disabled={attachmentBusy}
                      onClick={() => { setMoreOpen(false); fileInput.current?.click(); }}>
                      <FileUp size={20} aria-hidden="true" /> File
                    </button>
                  )}
                  {voiceAvailable && onVoice && (
                    <button type="button" role="menuitem" disabled={busy || locked || attachmentsLocked}
                      onClick={() => { setMoreOpen(false); onVoice(); }}>
                      {voiceActive ? <Square size={18} aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
                      {voiceActive ? "Stop recording" : "Voice message"}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {onFiles && (
            <input ref={fileInput} type="file" multiple className="sr-only" tabIndex={-1}
              aria-label="Choose files"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = "";
                if (files.length > 0) onFiles(files);
              }} />
          )}
        </div>}
        {showReveal && <button type="button" className="fb-peer-icon fb-peer-reveal"
          aria-label="Show attachments" aria-expanded={false}
          onClick={() => setReveal(true)}>
          <ChevronRight size={20} aria-hidden="true" />
        </button>}
      </div>
      <div className="fb-peer-field">
        <textarea ref={field} value={value} aria-label="Message" placeholder="Message" rows={1}
          // `readOnly`, never `disabled`: a disabled field blurs, and the owner's
          // complaint is precisely that the caret leaves the box on send.
          readOnly={locked}
          aria-disabled={locked || undefined}
          // Merely reaching the field does not hide the attachments: only text
          // in the field does that, and emptying it or leaving the field brings
          // them back.
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setReveal(null); }}
          onChange={(event) => {
            const next = event.target.value;
            // Text collapses the cluster; an empty draft follows the width
            // again, which is what restores it on a phone after a send.
            setReveal(next === "" ? null : false);
            const start = event.target.selectionStart ?? next.length;
            // Never rewrite under a selection or an active IME: the browser
            // owns that value until composition finishes.
            if (composing.current || (event.nativeEvent as InputEvent).isComposing || start !== (event.target.selectionEnd ?? start)) {
              onChange(next);
              return;
            }
            const live = convertEmoticonsLive(next, start);
            if (live.text === next) { onChange(next); return; }
            caret.current = live.caret;
            onChange(live.text);
          }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={(event) => {
            composing.current = false;
            const next = event.currentTarget.value;
            const at = event.currentTarget.selectionStart ?? next.length;
            const live = convertEmoticonsLive(next, at);
            if (live.text === next) return;
            caret.current = live.caret;
            onChange(live.text);
          }}
          onKeyDown={(event) => {
            if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey
              || event.ctrlKey || event.altKey || event.metaKey || composing.current
              || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (hasFinePointer()) { event.preventDefault(); if (!event.repeat) send(); }
          }} />
      </div>
      {klipy && button("Stickers and GIFs", <Sticker size={20} aria-hidden="true" />, () => setGifOpen(true), !photoAllowed || attachmentBusy)}
      <EmojiPickerButton onPick={pickEmoji} disabled={busy || locked} align="end"
        className="fb-peer-icon" label="Emoji" />
      <button type="submit" className="fb-peer-icon fb-peer-send" aria-label="Send message" disabled={!available}
        {...hoverLabel("Send message")}
        onMouseDown={(event) => {
          // Keep the IME open: tapping Send must not blur the field before the
          // draft is admitted and the restore state is applied.
          if (event.button === 0 && document.activeElement === field.current) event.preventDefault();
        }}>
        <SendHorizontal size={20} aria-hidden="true" />
      </button>
    </div>
    {klipy && gifOpen && (
      <div className="fb-picker-layer" style={{ left: 4 }}>
        <KlipyPicker
          testIdPrefix="chat-klipy"
          onPick={pickKlipy}
          onClose={() => setGifOpen(false)}
          onDismiss={() => setGifOpen(false)}
        />
      </div>
    )}
  </form>;
}
