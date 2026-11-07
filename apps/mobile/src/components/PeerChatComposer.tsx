import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, ChevronRight, ImagePlus, Mic, SendHorizontal, Square } from "lucide-react";
import { motionDurations, motionEasings, shouldReduceMotion } from "./uiMotion";
import { hasFinePointer } from "./inputCapabilities";
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
  /** Voice is a real capability flag: when false the control explains the
   * limitation instead of pretending to record. */
  voiceAvailable?: boolean;
  /** True while the microphone is actually open; the control then stops it. */
  voiceActive?: boolean;
  onVoice?: () => void;
  context?: ReactNode;
}

/**
 * Human-to-human composer.
 *
 * Exactly three attachment controls sit on the LEFT (Camera, Photos, Voice);
 * the text field follows; Send stays on the far right. There is no plus menu,
 * no file/emoji button and no outer capsule: the field keeps its own rounded
 * surface and every other control floats independently.
 *
 * Attachment expansion is explicit state, not `document.activeElement`:
 *   - opening an idle conversation shows the controls;
 *   - focusing/typing in the field collapses them behind `>`;
 *   - `>` slides them back out;
 *   - returning to the field collapses them again;
 *   - a successful send or clearing the whole draft restores them even while
 *     the keyboard is still open.
 */
export function PeerChatComposer({
  value, onChange, onSend, inputRef, busy, locked, canSend, attachmentsLocked = false,
  photoAllowed, onCamera, onPhotos, voiceAvailable = false, voiceActive = false, onVoice, context,
}: PeerChatComposerProps) {
  const [expanded, setExpanded] = useState(true);
  const field = inputRef;
  const composing = useRef(false);
  const available = canSend && !locked && !busy;
  const reduce = shouldReduceMotion();

  // Restore on send or on clearing the entire draft — including while the IME
  // is still open. It collapses again only on a deliberate return to the field
  // or on typing new content.
  useEffect(() => {
    if (value === "") setExpanded(true);
  }, [value]);

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    const style = getComputedStyle(element);
    const cap = Math.min(160, (parseFloat(style.lineHeight) || 20) * 4 +
      (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0));
    if (element.scrollHeight > 0) element.style.height = `${Math.min(cap, element.scrollHeight)}px`;
    element.style.overflowY = element.scrollHeight > cap ? "auto" : "hidden";
  }, [value, field]);

  const send = () => { if (available && !composing.current) onSend(); };

  const button = (label: string, icon: ReactNode, action: () => void, disabled = false) => (
    <button type="button" className="fb-peer-icon" aria-label={label} title={label}
      disabled={disabled} onClick={action}>
      {icon}
    </button>
  );

  return <form className="fb-peer-composer" aria-busy={busy || undefined}
    onSubmit={(event) => { event.preventDefault(); send(); }}>
    {context}
    <div className="fb-peer-composer-row">
      <div className="fb-peer-attachments">
        <AnimatePresence initial={false} mode="popLayout">
          {expanded ? (
            <motion.div key="controls" className="fb-peer-controls"
              initial={reduce ? false : { opacity: 0, x: -8, width: 0 }}
              animate={{ opacity: 1, x: 0, width: "auto" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: -8, width: 0 }}
              transition={{ duration: reduce ? 0 : motionDurations.fast, ease: motionEasings.out }}>
              {button("Take photo", <Camera size={21} aria-hidden="true" />, onCamera, !photoAllowed || busy || locked || attachmentsLocked)}
              {button("Choose photo", <ImagePlus size={21} aria-hidden="true" />, onPhotos, !photoAllowed || busy || locked || attachmentsLocked)}
              {/* Voice exists only when a real recording/playback path exists.
                  The handoff forbids a microphone that cannot record. */}
              {voiceAvailable && onVoice
                ? button(voiceActive ? "Stop recording" : "Voice message",
                  voiceActive ? <Square size={19} aria-hidden="true" /> : <Mic size={21} aria-hidden="true" />, onVoice, busy || locked || attachmentsLocked)
                : null}
            </motion.div>
          ) : (
            <motion.button key="reveal" type="button" className="fb-peer-icon fb-peer-reveal"
              aria-label="Show attachments" aria-expanded={false}
              initial={reduce ? false : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: reduce ? 0 : motionDurations.instant }}
              onClick={() => setExpanded(true)}>
              <ChevronRight size={20} aria-hidden="true" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <div className="fb-peer-field">
        <textarea ref={field} value={value} aria-label="Message" placeholder="Message" rows={1}
          disabled={locked}
          onFocus={() => setExpanded(false)}
          onPointerDown={() => setExpanded(false)}
          onChange={(event) => {
            const next = event.target.value;
            setExpanded(next === "");
            onChange(next);
          }}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey
              || event.ctrlKey || event.altKey || event.metaKey || composing.current
              || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (hasFinePointer()) { event.preventDefault(); if (!event.repeat) send(); }
          }} />
      </div>
      <button type="submit" className="fb-peer-icon fb-peer-send" aria-label="Send message" disabled={!available}
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
