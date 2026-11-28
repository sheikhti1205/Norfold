/**
 * jsdom implements no Range geometry.
 *
 * ProseMirror's `scrollToSelection` measures the selection through
 * `Range.getClientRects()` (falling back to `Range.getBoundingClientRect()`)
 * whenever a transaction asks to scroll, so an undo or a selection dispatch
 * throws `target.getClientRects is not a function` even though a real browser
 * implements both. Tests still need the real dispatch path, so stub only the
 * two missing methods with an empty/zero rect and restore whatever jsdom had
 * when the test ends.
 *
 * `polyfillRangeGeometry` ignores its arguments, so it is safe to pass to
 * `beforeEach` directly (Vitest hands the hook a test context).
 */
let undo: (() => void) | null = null;

export function polyfillRangeGeometry(): void {
  if (undo || typeof Range === "undefined") return;
  const proto = Range.prototype as unknown as Record<string, unknown>;
  const savedRects = Object.getOwnPropertyDescriptor(proto, "getClientRects");
  const savedBounds = Object.getOwnPropertyDescriptor(proto, "getBoundingClientRect");

  if (typeof proto.getClientRects !== "function") {
    Object.defineProperty(proto, "getClientRects", {
      configurable: true,
      writable: true,
      value: () => [],
    });
  }
  if (typeof proto.getBoundingClientRect !== "function") {
    Object.defineProperty(proto, "getBoundingClientRect", {
      configurable: true,
      writable: true,
      value: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    });
  }

  undo = () => {
    if (savedRects) Object.defineProperty(proto, "getClientRects", savedRects);
    else Reflect.deleteProperty(proto, "getClientRects");
    if (savedBounds) Object.defineProperty(proto, "getBoundingClientRect", savedBounds);
    else Reflect.deleteProperty(proto, "getBoundingClientRect");
  };
}

/** Undo the stub installed for this test, leaving jsdom as it was. */
export function restoreRangeGeometry(): void {
  const restore = undo;
  undo = null;
  restore?.();
}
