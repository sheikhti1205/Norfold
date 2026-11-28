import { useId, useState } from "react";
import { Film, Smile, Sticker, X } from "lucide-react";
import { EmojiPicker } from "./EmojiPicker";
import { KlipyPicker } from "./KlipyPicker";
import {
  readExpressionRecents,
  rememberExpression,
  rememberedEmoji,
  rememberedKlipy,
  type ExpressionRecent,
} from "../services/expressionRecents";
import type { KlipyItem, KlipyKind } from "../services/klipy";
import "./EmojiPicker.css";

export type ExpressionTab = "emoji" | KlipyKind;

export interface ExpressionPickerProps {
  /** Signed-in reader, hashed into the stable provider customer id. */
  userId?: string | null;
  /** Prefix for the test ids the embedded provider panel renders. */
  testIdPrefix?: string;
  onPickEmoji: (emoji: string) => void;
  onPickKlipy: (item: KlipyItem) => void;
  /** A GIF or sticker is a complete message: picking one closes the panel. */
  onClose: () => void;
  onDismiss?: () => void;
  /**
   * Presentation: a floating popover (default) or a docked pane that sits in
   * the composer's flow and can take the on-screen keyboard's place.
   */
  dock?: "popover" | "ime";
}

/**
 * One picker for emoji, GIFs and stickers.
 *
 * The composer row kept three separate panels open for the same intent, and
 * the reader had to know which control hid which content. Here the three are
 * tabs of one surface, and what this device used last sits above them. Recents
 * are local to the device (`services/expressionRecents`), never synced.
 *
 * The provider panel keeps its own honest states: with no Klipy key the GIF
 * and sticker tabs say so instead of showing invented tiles.
 *
 * `dock="ime"` renders the same content as a pane in normal flow: a decorative
 * drag handle, the tab row and close control stay put, and the grid scrolls
 * underneath. The caller decides the pane's height; `min-height` keeps it
 * usable when the caller is auto-height. `dock="popover"` keeps the original
 * floating layer behaviour, including the close affordances around it.
 */
export function ExpressionPicker({
  userId = null, testIdPrefix = "expression", onPickEmoji, onPickKlipy, onClose, onDismiss,
  dock = "popover",
}: ExpressionPickerProps) {
  const [tab, setTab] = useState<ExpressionTab>("emoji");
  const [recents, setRecents] = useState<ExpressionRecent[]>(readExpressionRecents);
  const testId = (suffix: string) => `${testIdPrefix}-${suffix}`;
  const docked = dock === "ime";
  // The tab/tabpanel pair needs stable ids; `useId` keeps two pickers that
  // share a `testIdPrefix` from colliding.
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const panelId = `${baseId}-panel`;
  const tabId = (value: ExpressionTab) => `${baseId}-tab-${value}`;

  function pickEmoji(glyph: string) {
    setRecents(rememberExpression(rememberedEmoji(glyph)));
    onPickEmoji(glyph);
  }

  function pickKlipy(item: KlipyItem) {
    setRecents(rememberExpression(rememberedKlipy(item)));
    onPickKlipy(item);
    onClose();
  }

  const tabs: ReadonlyArray<{ id: ExpressionTab; label: string; icon: typeof Smile }> = [
    { id: "emoji", label: "Emoji", icon: Smile },
    { id: "gifs", label: "GIFs", icon: Film },
    { id: "stickers", label: "Stickers", icon: Sticker },
  ];

  const recentsNode = recents.length > 0 && (
    <div className="fb-expression-recents" data-testid={testId("recents")}>
      <p className="fb-expression-label">Recent</p>
      <div className="fb-expression-recent-row">
        {recents.map((recent) => recent.type === "emoji" ? (
          <button
            key={recent.key}
            type="button"
            className="fb-expression-recent fb-expression-recent-emoji"
            aria-label={`Recent ${recent.emoji}`}
            onClick={() => pickEmoji(recent.emoji)}
          >
            {recent.emoji}
          </button>
        ) : (
          <button
            key={recent.key}
            type="button"
            className="fb-expression-recent"
            aria-label={`Recent ${recent.item.title}`}
            onClick={() => pickKlipy({
              ...recent.item,
              raw: null,
            })}
          >
            <img src={recent.item.previewUrl} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );

  const content = tab === "emoji" ? (
    <EmojiPicker onPick={pickEmoji} />
  ) : (
    <KlipyPicker
      key={tab}
      userId={userId}
      initialTab={tab}
      showTabs={false}
      testIdPrefix={testIdPrefix}
      onPick={pickKlipy}
      onClose={onClose}
      onDismiss={onDismiss ?? onClose}
    />
  );

  return (
    <div
      className={docked ? "fb-expression-picker fb-expression-dock" : "fb-expression-picker"}
      data-testid={`${testIdPrefix}-picker`}
      data-dock={dock}
    >
      {docked && (
        <div className="fb-expression-drag" aria-hidden="true">
          <span className="fb-expression-drag-bar" />
        </div>
      )}
      <div className="fb-expression-head">
        <div role="tablist" aria-label="Emoji, GIFs and stickers" className="fb-expression-tabs">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={docked ? tabId(id) : undefined}
              aria-controls={docked ? panelId : undefined}
              aria-selected={tab === id}
              data-testid={testId(`tab-${id}`)}
              onClick={() => setTab(id)}
              className="fb-expression-tab min-h-[48px]"
              style={{ minHeight: 48 }}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="fb-expression-close" aria-label="Close picker"
          onClick={onDismiss ?? onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {docked ? (
        <div
          className="fb-expression-tabpanel"
          role="tabpanel"
          id={panelId}
          aria-labelledby={tabId(tab)}
        >
          {recentsNode}
          {content}
        </div>
      ) : (
        <>
          {recentsNode}
          {content}
        </>
      )}
    </div>
  );
}
