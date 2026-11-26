import { useState } from "react";
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
 */
export function ExpressionPicker({
  userId = null, testIdPrefix = "expression", onPickEmoji, onPickKlipy, onClose, onDismiss,
}: ExpressionPickerProps) {
  const [tab, setTab] = useState<ExpressionTab>("emoji");
  const [recents, setRecents] = useState<ExpressionRecent[]>(readExpressionRecents);
  const testId = (suffix: string) => `${testIdPrefix}-${suffix}`;

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

  return (
    <div className="fb-expression-picker" data-testid={`${testIdPrefix}-picker`}>
      <div className="fb-expression-head">
        <div role="tablist" aria-label="Emoji, GIFs and stickers" className="fb-expression-tabs">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
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

      {recents.length > 0 && (
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
      )}

      {tab === "emoji" ? (
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
      )}
    </div>
  );
}
