import { useEffect, useRef, useState } from "react";
import { Film, ImageOff, Search, Sticker, X } from "lucide-react";
import {
  KLIPY_ATTRIBUTION,
  KLIPY_ATTRIBUTION_URL,
  KLIPY_SEARCH_PLACEHOLDER,
  createKlipySearchController,
  isKlipyEnabled,
  klipyCustomerId,
  searchKlipyGifs,
  searchKlipyStickers,
  type KlipyItem,
  type KlipyKind,
  type KlipySearchController,
  type KlipySearchState,
} from "../services/klipy";
import "./EmojiPicker.css";

export interface KlipyPickerProps {
  /** Signed-in reader, hashed into the stable provider customer id. */
  userId?: string | null;
  initialTab?: KlipyKind;
  /** Prefix for the test ids this panel renders, e.g. `comment-gif`. */
  testIdPrefix?: string;
  /** The unified expression picker owns the tab row; hide this one's. */
  showTabs?: boolean;
  onPick: (item: KlipyItem) => void;
  onClose: () => void;
  /** Close when Escape is pressed and hand focus back to the caller. */
  onDismiss?: () => void;
}

/** Waterfall tile heights for the loading skeleton (varied, like real results). */
const SKELETON_HEIGHTS = [112, 84, 96, 72, 104, 88];

/**
 * CSS aspect-ratio for a picker tile, derived from the provider's media
 * dimensions so the collage waterfalls naturally. Clamped so a malformed
 * payload can never create an absurdly tall or wide tile; stickers (often
 * square transparent PNG/WebP) fall back to 1:1.
 */
function tileAspect(item: KlipyItem): string {
  const width = item.width ?? 0;
  const height = item.height ?? 0;
  if (width <= 0 || height <= 0) return "1 / 1";
  return `${Math.min(2, Math.max(0.5, width / height))} / 1`;
}

/**
 * One sticker/GIF picker for the whole app.
 *
 * The provider adapter owns debounce, latest-request-wins, stale-request
 * cancellation, trending-on-empty, pagination and the loading/empty/error
 * states; this component owns only the panel. The comment composer and the
 * conversation composer both mount it, so there is one search behaviour, one
 * attribution line and one set of test ids (`testIdPrefix`).
 */
export function KlipyPicker({
  userId = null, initialTab = "gifs", testIdPrefix = "klipy", showTabs = true, onPick, onClose, onDismiss,
}: KlipyPickerProps) {
  const [tab, setTab] = useState<KlipyKind>(initialTab);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<KlipySearchState>({
    status: "idle", tab: initialTab, query: "", items: [], page: 1, error: null,
  });
  const controller = useRef<KlipySearchController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const enabled = isKlipyEnabled();
  const testId = (suffix: string) => `${testIdPrefix}-${suffix}`;

  function current(): KlipySearchController {
    if (!controller.current) {
      controller.current = createKlipySearchController({
        customerId: () => klipyCustomerId(userId),
        searchGifs: (...args) => searchKlipyGifs(...args),
        searchStickers: (...args) => searchKlipyStickers(...args),
        onState: (next) => setState(next),
      });
    }
    return controller.current;
  }

  useEffect(() => () => controller.current?.dispose(), []);

  // Searching on open, on tab change and on each keystroke; cancelled on close.
  useEffect(() => {
    if (!enabled) return;
    current().search(query, tab);
  }, [enabled, tab, query]);

  // Standalone, this panel owns Escape and outside presses. Embedded in the
  // unified expression picker it must not: the tab row and the close button
  // live outside this component, and its own listener would treat a tab press
  // as a dismiss and close the whole picker.
  useEffect(() => {
    if (!showTabs) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      (onDismiss ?? onClose)();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [onClose, onDismiss, showTabs]);

  useEffect(() => { searchRef.current?.focus(); }, []);

  if (!enabled) {
    // The control exists even when the deployment has no provider key. It
    // opens a real panel that says so; it never renders fake tiles or a search
    // field that cannot search.
    return (
      <div ref={root} className="fb-klipy-picker" data-testid={testId("panel")} role={showTabs ? "dialog" : "group"} aria-label="GIF and sticker picker">
        <div className="fb-klipy-search-row fb-klipy-search-row-plain">
          <p className="fb-klipy-unavailable-title">GIFs and stickers</p>
          <button type="button" className="fb-klipy-clear min-h-[48px]" aria-label="Close"
            onClick={onDismiss ?? onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="fb-klipy-body">
          <div role="status" data-testid={testId("unavailable")} className="fb-klipy-status">
            <ImageOff size={20} aria-hidden="true" />
            <p>GIFs and stickers aren't available right now.</p>
            <p>Try again later.</p>
          </div>
        </div>
      </div>
    );
  }
  const loading = state.status === "loading";
  const items = state.items;

  return (
    <div ref={root} className="fb-klipy-picker" data-testid={testId("panel")} role={showTabs ? "dialog" : "group"} aria-label="GIF and sticker picker">
      <div className="fb-klipy-search-row">
        <div className="fb-klipy-search-wrap">
          <Search size={16} aria-hidden="true" />
          <input
            ref={searchRef}
            data-testid={testId("search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={KLIPY_SEARCH_PLACEHOLDER}
            aria-label="Search GIFs and stickers"
            enterKeyHint="search"
            className="fb-klipy-search min-h-[48px]"
            autoComplete="off"
          />
          {query !== "" && (
            <button type="button" data-testid={testId("search-clear")} onClick={() => setQuery("")}
              aria-label="Clear search" className="fb-klipy-clear min-h-[48px]">
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {showTabs && (
        <div role="tablist" aria-label="GIF or stickers" className="fb-klipy-tabs">
          {(["gifs", "stickers"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              data-testid={testId(`tab-${value}`)}
              onClick={() => setTab(value)}
              className="fb-klipy-tab min-h-[48px]"
            >
              {value === "gifs" ? <Film size={14} aria-hidden="true" /> : <Sticker size={14} aria-hidden="true" />}
              {value === "gifs" ? "GIFs" : "Stickers"}
            </button>
          ))}
        </div>
      )}

      <div className="fb-klipy-body">
        {state.status === "error" ? (
          <div role="alert" className="fb-klipy-status">
            <ImageOff size={20} aria-hidden="true" />
            <p>{state.error ?? "Couldn't load GIFs."}</p>
            <button type="button" data-testid={testId("retry")} onClick={() => current().search(query, tab)} className="fb-klipy-retry min-h-[48px]">
              Try again
            </button>
          </div>
        ) : loading ? (
          <div>
            <p role="status" className="fb-klipy-status">Loading {tab === "gifs" ? "GIFs" : "stickers"}...</p>
            <div className="fb-klipy-grid" aria-hidden="true">
              {SKELETON_HEIGHTS.map((height, index) => (
                <span key={index} className="fb-klipy-skeleton animate-pulse" style={{ height }} />
              ))}
            </div>
          </div>
        ) : items.length === 0 ? (
          <div role="status" className="fb-klipy-status">
            <ImageOff size={20} aria-hidden="true" />
            <p>{query.trim() ? "No results. Try another search." : "Nothing to show right now. Try a search."}</p>
          </div>
        ) : (
          <div>
            {query.trim() === "" && <p data-testid={testId("trending")} className="fb-klipy-trending">Trending now</p>}
            <div className="fb-klipy-grid">
              {items.map((item) => (
                <button
                  key={`${item.kind}:${item.slug}`}
                  type="button"
                  data-testid={testId(`result-${item.slug}`)}
                  onClick={() => onPick(item)}
                  aria-label={`Add ${item.title}`}
                  className="fb-klipy-tile"
                  style={{ aspectRatio: tileAspect(item) }}
                >
                  <img src={item.previewUrl} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="fb-klipy-attribution">
        <a href={KLIPY_ATTRIBUTION_URL} target="_blank" rel="noreferrer">{KLIPY_ATTRIBUTION}</a>
      </p>
    </div>
  );
}
