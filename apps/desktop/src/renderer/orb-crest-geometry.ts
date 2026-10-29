/**
 * Snap the visible crest to physical pixels. The travelling glass sphere
 * retains its compositor scale, while the crest is painted independently at
 * its final display size rather than scaling a rasterized intermediate layer.
 */
export function crispCrestBounds(
  rect: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">,
  devicePixelRatio: number,
): { left: number; top: number; width: number; height: number } {
  const dpr =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const align = (value: number): number => Math.round(value * dpr) / dpr;
  const left = align(rect.left);
  const top = align(rect.top);
  return {
    left,
    top,
    width: Math.max(1 / dpr, align(rect.right) - left),
    height: Math.max(1 / dpr, align(rect.bottom) - top),
  };
}
