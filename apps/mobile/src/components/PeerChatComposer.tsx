import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Camera, FileUp, ImagePlus, MapPin, Mic, Music, Plus, SendHorizontal, Video } from "lucide-react";
import { hasFinePointer } from "./inputCapabilities";
import { useHoverLabel } from "./HoverLabel";
import { convertEmoticonsLive } from "../utils/emoji";
import { ExpressionPickerButton } from "./ExpressionPickerButton";
import { insertEmoji } from "./EmojiPicker";
import { type KlipyItem } from "../services/klipy";
import { registerBackInterceptor } from "./backNavigation";
import "./peerComposer.css";

/** The type a hidden picker offers. Each row opens exactly one kind. */
export type ChatFileKind = "document" | "audio" | "video";

const FILE_ACCEPT: Record<ChatFileKind, string> = {
  // Documents and archives: the catch-all "File" row is gone, so a reader who
  // wants a PDF is not shown a music library they never asked for.
  document: ".pdf,.doc,.docx,.odt,.rtf,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.7z,.tar,.gz,application/pdf,text/*,application/msword,application/vnd.openxmlformats-officedocument.*,application/vnd.ms-*,application/vnd.oasis.opendocument.*,application/zip,application/x-zip-compressed,application/x-rar-compressed,application/x-7z-compressed,application/gzip,application/x-tar",
  audio: "audio/*",
  video: "video/*",
};

const FILE_LABEL: Record<ChatFileKind, string> = {
  document: "Choose document",
  audio: "Choose audio",
  video: "Choose video",
};

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
  context?: ReactNode;
}

/**
 * Human-to-human composer.
 *
 * One attachment control opens a sheet of real file capabilities (photos,
 * camera, video, document, audio, location) and each row starts a picker
 * narrowed to that type (owner direction 2026-11-18). One control carries
 * emoji, GIFs and stickers. Voice is a first-class control of its own: when the
 * conversation can record, a mic sits between that expression trigger and Send,
 * so recording never needs a menu first, and the sheet keeps no second copy of
 * it (owner direction 2026-11-18).
 *
 * The field keeps its own rounded surface; every other control floats
 * independently. There is no enclosing capsule. The field is `min-width: 0`, so
 * the controls never overflow at 320dp: the field absorbs the difference.
 */
export function PeerChatComposer({
  value, onChange, onSend, inputRef, busy, locked, canSend, attachmentsLocked = false,
  photoAllowed, onCamera, onPhotos, onFiles, fileSending = false, onLocation,
  voiceAvailable = false, onVoice, onPickKlipy, userId = null, context,
}: PeerChatComposerProps) {
  const [focused, setFocused] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const field = inputRef;
  const attachRoot = useRef<HTMLDivElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const inputs: Record<ChatFileKind, RefObject<HTMLInputElement | null>> = {
    document: documentInput, audio: audioInput, video: videoInput,
  };
  const composing = useRef(false);
  // Live conversion changes the value, so the caret it produced is restored
  // after React commits instead of being left wherever the browser guessed.
  const caret = useRef<number | null>(null);
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

  // Close the attachment sheet on an outside press, Escape or Android Back.
  // Escape is consumed here, and the sheet registers as the topmost Back layer
  // while open, so the conversation's own leave gesture never runs on the same
  // press after this layer has already handled it.
  useEffect(() => {
    if (!attachOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (attachRoot.current && !attachRoot.current.contains(event.target as Node)) setAttachOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setAttachOpen(false); }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    const offBack = registerBackInterceptor(() => { setAttachOpen(false); return true; });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      offBack();
    };
  }, [attachOpen]);

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
    onPickKlipy?.(item);
  }

  function chooseFile(kind: ChatFileKind) {
    setAttachOpen(false);
    inputs[kind].current?.click();
  }

  const canAttachPhotos = photoAllowed && !attachmentBusy;

  return <form className="fb-peer-composer" aria-busy={busy || fileSending || undefined}
    onSubmit={(event) => { event.preventDefault(); send(); }}>
    {context}
    <div className="fb-peer-composer-row">
      <div className="relative" ref={attachRoot}>
        <button type="button" className="fb-peer-icon" aria-label="Add attachment"
          aria-haspopup="menu" aria-expanded={attachOpen}
          disabled={attachmentBusy}
          onClick={() => setAttachOpen((open) => !open)}
          {...hoverLabel("Add attachment")}>
          <Plus size={22} aria-hidden="true" />
        </button>
        {attachOpen && (
          <div className="fb-picker-layer fb-peer-attach-menu" data-size="menu" role="menu" aria-label="Add attachment">
            <button type="button" role="menuitem" disabled={!canAttachPhotos}
              onClick={() => { setAttachOpen(false); onPhotos(); }}>
              <ImagePlus size={20} aria-hidden="true" /> Photos
            </button>
            <button type="button" role="menuitem" disabled={!canAttachPhotos}
              onClick={() => { setAttachOpen(false); onCamera(); }}>
              <Camera size={20} aria-hidden="true" /> Camera
            </button>
            {onFiles && (
              <>
                <button type="button" role="menuitem" disabled={attachmentBusy} onClick={() => chooseFile("video")}>
                  <Video size={20} aria-hidden="true" /> Video
                </button>
                <button type="button" role="menuitem" disabled={attachmentBusy} onClick={() => chooseFile("document")}>
                  <FileUp size={20} aria-hidden="true" /> Document
                </button>
                <button type="button" role="menuitem" disabled={attachmentBusy} onClick={() => chooseFile("audio")}>
                  <Music size={20} aria-hidden="true" /> Audio
                </button>
              </>
            )}
            {onLocation && (
              <button type="button" role="menuitem" onClick={() => { setAttachOpen(false); onLocation(); }}>
                <MapPin size={20} aria-hidden="true" /> Location
              </button>
            )}
          </div>
        )}
        {onFiles && (Object.keys(FILE_ACCEPT) as ChatFileKind[]).map((kind) => (
          <input key={kind} ref={inputs[kind]} type="file" multiple className="sr-only" tabIndex={-1}
            accept={FILE_ACCEPT[kind]} aria-label={FILE_LABEL[kind]}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              if (files.length > 0) onFiles(files, kind);
            }} />
        ))}
      </div>
      <div className="fb-peer-field">
        <textarea ref={field} value={value} aria-label="Message" placeholder="Message" rows={1}
          // `readOnly`, never `disabled`: a disabled field blurs, and the owner's
          // complaint is precisely that the caret leaves the box on send.
          readOnly={locked}
          aria-disabled={locked || undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
      <ExpressionPickerButton onPickEmoji={pickEmoji} onPickKlipy={pickKlipy}
        userId={userId} disabled={busy || locked} align="end"
        className="fb-peer-icon" testIdPrefix="chat-expression" />
      {voiceAvailable && onVoice && <button type="button" className="fb-peer-icon" aria-label="Voice message"
        disabled={busy || locked || attachmentsLocked} onClick={onVoice} {...hoverLabel("Voice message")}>
        <Mic size={20} aria-hidden="true" />
      </button>}
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
  </form>;
}
