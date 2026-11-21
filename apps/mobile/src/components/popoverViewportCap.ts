/**
 * Viewport-relative height cap for layered popovers.
 *
 * React Aria writes the open overlay's max-height inline (its collision
 * adjusted value), which outranks any stylesheet max-height, so a CSS cap can
 * never hold. Callers therefore compute the cap from the live viewport and pass
 * it through the layered popover's `maxHeight` prop, which React Aria applies as
 * the inline max-height the popover renders.
 */
export function layeredPopoverMaxHeight(viewportHeightPx: number, ceilingPx: number): number {
  return Math.min(ceilingPx, Math.round(viewportHeightPx / 2));
}
