import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from "react";
import { Camera, FileUp, ImagePlus, MapPin, Mic, SendHorizontal } from "lucide-react";
import { hasFinePointer } from "./inputCapabilities";
import { useHoverLabel } from "./HoverLabel";
import { convertEmoticonsLive } from "../utils/emoji";
import { AttachmentTray, type AttachmentOption } from "./AttachmentTray";
import { ComposerDock, ExpressionDockTrigger, useComposerDock } from "./ComposerDock";
import { ExpressionPicker } from "./ExpressionPicker";
import { insertEmoji } from "./EmojiPicker";
import { type KlipyItem } from "../services/klipy";
import "./peerComposer.css";

/** The type a hidden picker offers, forwarded to the screen's own file owner. */
export type ChatFileKind = "document" | "audio" | "video";

/**
 * One media picker offers stills and clips together; the screen's file owner
 * stages a mixed selection (`stageLocalFiles`), and the private file lane is the
 * only chat path that can carry a video — the native photo intake is image-only
 * by design.
 */
const MEDIA_ACCEPT = "image/*,video/*";

/**
 * Documents and audio files are one capability on the owner's list, so one
 * picker covers PDFs, archives and audio. The catch-all "File" row stays gone.
 */
const DOCUMENT_ACCEPT = ".pdf,.doc,.docx,.odt,.rtf,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.tar,.gz,application/pdf,text/*,application/msword,application/vnd.openxmlformats-officedocument.*,application/vnd.ms-*,application/vnd.oasis.opendocument.*,application/zip,application/x-zip-compressed,application/x-rar-compressed,application/x-7z-compressed,application/gzip,application/x-tar,audio/*";

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
  /** A non-photo file, filtered by the row that started the picker. The
   * screen's file owner still validates and refuses; the composer only
   * narrows what the operating system offers. */
  onFiles?: (files: File[], kind: ChatFileKind) => void;
  fileSending?: boolean;
  /** Opens the screen's location composer; absent where location is not a
   * capability, so no dead row is ever shown. */
  onLocation?: () => void;
  /** Voice is a real capability flag: when false the control is not offered at
   * all instead of pretending to record. */
  voiceAvailable?: boolean;
  onVoice?: () => void;
  /** A picked sticker/GIF. The screen sends it; the composer never guesses
   * how a conversation carries media. */
  onPickKlipy?: (item: KlipyItem) => void;
  /** Signed-in reader, hashed into the provider customer id. */
  userId?: string | null;
  /** Image-only clipboard paste. Present only where the screen's one media
   *  admission owner accepts staged attachments; plain or mixed text paste is
   *  never intercepted here. */
  onPasteImages?: (files: File[]) => void;
  /** Reports the field's focus so the screen advertises keyboard/provider
   *  insertion only while this composer actually owns the caret. */
  onFocusChange?: (focused: boolean) => void;
  /** Reports a press on this field (`true`) and its withdrawal (`false`).
   *  The screen may advertise on the press, before the focus event and its
   *  bridge round trip; nothing is committed here, and focus landing on any
   *  other control withdraws it. */
  onKeyboardIntentChange?: (intent: boolean) => void;
  context?: ReactNode;
}

/**
 * Human-to-human composer.
 *
 * One `+` disclosure carries every real file capability (documents and audio,
 * photos and videos, camera, voice note, location), the same shared tray the
 * comment composer mounts. Collapsed it is one control; expanded the shortcuts
 * sit inline beside the field and the field gives up exactly their width, so
 * the picker button and Send never move. Any draft text folds the row back to
 * the single `+` until the field is empty again.
 *
 * The field keeps its own rounded surface; every other control floats
 * independently. There is no enclosing capsule. The field is `min-width: 0`, so
 * the controls never overflow at 320dp: the field absorbs the difference.
 */
export function PeerChatComposer({
  value, onChange, onSend, inputRef, busy, locked, canSend, attachmentsLocked = false,
  photoAllowed, onCamera, onPhotos, onFiles, fileSending = false, onLocation,
  voiceAvailable = false, onVoice, onPickKlipy, userId = null, onPasteImages, onFocusChange,
  onKeyboardIntentChange, context,
}: PeerChatComposerProps) {
  const [focused, setFocused] = useState(false);
  const [intent, setIntent] = useState(false);
  const field = inputRef;
  const mediaInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  // Live conversion changes the value, so the caret it produced is restored
  // after React commits instead of being left wherever the browser guessed.
  const caret = useRef<number | null>(null);
  const attachmentBusy = busy || locked || attachmentsLocked || fileSending;
  const dock = useComposerDock(field);
  const { hoverLabel } = useHoverLabel();

  useLayoutEffect(() => {
    const next = caret.current;
    if (next === null) return;
    caret.current = null;
    const element = field.current;
    if (element && document.activeElement === element) element.setSelectionRange(next, next);
  }, [value, field]);
  const available = canSend && !locked && !busy;

  // The field grows to four lines while focused; blurred it rests at one line.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    const style = getComputedStyle(element);
    const line = parseFloat(style.lineHeight) || 20;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const cap = focused ? Math.min(160, line * 4 + padding) : line + padding;
    if (element.scrollHeight > 0) element.style.height = `${Math.min(cap, element.scrollHeight)}px`;
    element.style.overflowY = focused && element.scrollHeight > cap ? "auto" : "hidden";
  }, [value, field, focused]);

  // A press on the field is the earliest honest signal that this composer is
  // about to own the IME. The screen may advertise from it before the focus
  // event and its asynchronous bridge call; this only widens WHEN the native
  // flag is set, never what a commit may do.
  useEffect(() => {
    onKeyboardIntentChange?.(intent);
  }, [intent, onKeyboardIntentChange]);

  // A press is provisional: focus landing anywhere else, a press on any other
  // control, or this field going away ends it immediately instead of leaving
  // the screen advertised behind something the reader chose instead. The
  // capture phase sees `focus`, which does not bubble.
  useEffect(() => {
    if (!intent) return;
    const withdrawFocus = (event: FocusEvent) => {
      if (event.target !== field.current) setIntent(false);
    };
    const withdrawPress = (event: PointerEvent) => {
      if (event.target !== field.current) setIntent(false);
    };
    document.addEventListener("focus", withdrawFocus, true);
    document.addEventListener("pointerdown", withdrawPress, true);
    return () => {
      document.removeEventListener("focus", withdrawFocus, true);
      document.removeEventListener("pointerdown", withdrawPress, true);
      onKeyboardIntentChange?.(false);
    };
  }, [intent, field, onKeyboardIntentChange]);

  const send = () => { if (available && !composing.current) onSend(); };

  function pickEmoji(glyph: string) {
    const element = field.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? start;
    const inserted = insertEmoji(value, start, end, glyph);
    caret.current = inserted.caret;
    onChange(inserted.text);
    // A docked pane replaces the keyboard: inserting must not summon the IME
    // back underneath the pane.
    if (!dock.open) element?.focus();
  }

  function pickKlipy(item: KlipyItem) {
    onPickKlipy?.(item);
  }

  function forwardFiles(event: ChangeEvent<HTMLInputElement>, kind: ChatFileKind) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length > 0) onFiles?.(files, kind);
  }

  function openMedia() {
    // One picker for stills and clips. Without the file lane the surface's own
    // photo owner is the only route, which is what it has always been.
    if (onFiles) { mediaInput.current?.click(); return; }
    onPhotos();
  }

  const canAttachPhotos = photoAllowed && !attachmentBusy;

  const attachmentOptions: AttachmentOption[] = [];
  if (onFiles) {
    attachmentOptions.push({
      id: "documents", label: "Documents", icon: <FileUp size={20} aria-hidden="true" />,
      disabled: attachmentBusy, onSelect: () => documentInput.current?.click(),
    });
  }
  attachmentOptions.push({
    id: "media", label: "Photos and videos", icon: <ImagePlus size={20} aria-hidden="true" />,
    disabled: !canAttachPhotos, onSelect: openMedia,
  });
  attachmentOptions.push({
    id: "camera", label: "Camera", icon: <Camera size={20} aria-hidden="true" />,
    disabled: !canAttachPhotos, onSelect: onCamera,
  });
  if (voiceAvailable && onVoice) {
    attachmentOptions.push({
      id: "voice", label: "Voice note", icon: <Mic size={20} aria-hidden="true" />,
      disabled: busy || locked || attachmentsLocked, onSelect: onVoice,
    });
  }
  if (onLocation) {
    attachmentOptions.push({
      id: "location", label: "Location", icon: <MapPin size={20} aria-hidden="true" />,
      onSelect: onLocation,
    });
  }

  return <form className="fb-peer-composer" aria-busy={busy || fileSending || undefined}
    onSubmit={(event) => { event.preventDefault(); send(); }}>
    {context}
    <div className="fb-peer-composer-row">
      <AttachmentTray options={attachmentOptions} hasText={value.trim() !== ""} text={value}
        disabled={attachmentBusy} label="Add attachment" testIdPrefix="chat-attachment" />
      <div className="fb-peer-field">
        <textarea ref={field} value={value} aria-label="Message" placeholder="Message" rows={1}
          // `readOnly`, never `disabled`: a disabled field blurs, and the problem
          // is precisely that the caret leaves the box on send.
          readOnly={locked}
          aria-disabled={locked || undefined}
          // A press precedes focus: it lets the screen advertise the field
          // while the keyboard is still opening, without restarting the IME.
          // Only a writable field can carry an insertion, so a locked composer
          // never prearms.
          onPointerDown={() => { if (!locked) setIntent(true); }}
          onTouchStart={() => { if (!locked) setIntent(true); }}
          onFocus={() => { setFocused(true); onFocusChange?.(true); }}
          onBlur={() => { setFocused(false); setIntent(false); onFocusChange?.(false); }}
          onPaste={(event) => {
            // Image-only paste joins the screen's media admission owner. Any
            // text (plain or mixed) and any active IME composition keeps the
            // browser's own paste path, so nothing is admitted twice.
            if (!onPasteImages || composing.current) return;
            const data = event.clipboardData;
            if (!data || data.getData("text/plain").trim() !== "") return;
            const pasted = Array.from(data.files ?? []);
            if (pasted.length === 0 || !pasted.every((file) => file.type.startsWith("image/"))) return;
            event.preventDefault();
            onPasteImages(pasted);
          }}
          onChange={(event) => {
            const next = event.target.value;
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
      <ExpressionDockTrigger open={dock.open} onToggle={dock.toggle}
        disabled={busy || locked} className="fb-peer-icon"
        label="Emoji, GIFs and stickers" testId="chat-expression" />
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
    {onFiles && (
      <>
        <input ref={mediaInput} type="file" multiple className="sr-only" tabIndex={-1}
          accept={MEDIA_ACCEPT} aria-label="Choose photos or videos"
          onChange={(event) => forwardFiles(event, "video")} />
        <input ref={documentInput} type="file" multiple className="sr-only" tabIndex={-1}
          accept={DOCUMENT_ACCEPT} aria-label="Choose documents or audio"
          onChange={(event) => forwardFiles(event, "document")} />
      </>
    )}
    {dock.open && (
      <ComposerDock heightPx={dock.heightPx} label="Emoji, GIFs and stickers picker"
        onRequestClose={dock.close} testId="chat-expression-pane">
        <ExpressionPicker dock="ime" userId={userId} testIdPrefix="chat-expression"
          onPickEmoji={pickEmoji} onPickKlipy={pickKlipy}
          onClose={dock.close} onDismiss={dock.close} />
      </ComposerDock>
    )}
  </form>;
}
