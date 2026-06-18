import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * VirtualizedList — windowed rendering for long lists.
 *
 * Mounts only the DOM nodes currently in the viewport (plus an
 * `overscan` buffer above/below), so render time and DOM weight stay
 * flat as the underlying array grows. Powered by
 * `@tanstack/react-virtual`.
 *
 * Sizing strategy:
 * - `estimateSize` is the initial best-guess pixel height for each
 * row. The virtualizer remeasures real items as they mount, so the
 * guess only needs to be in the right ballpark.
 * - `overscan` is how many extra items render off-screen on each end.
 * The default (5) trades a small render-cost bump for noticeably
 * smoother scroll.
 *
 * When to use this vs. plain `.map()`:
 * - List length > ~25–30 items: use VirtualizedList.
 * - Small/known-bounded lists (toolbars, filter selects): plain map
 * is fine. The virtualizer adds layout complexity (fixed-height
 * viewport, absolutely-positioned children) that isn't worth it
 * below the threshold.
 *
 * @template T - element shape; not constrained, but `getKey` should
 * return a stable string id for React reconciliation.
 *
 * @param props.items - the full list to virtualize.
 * @param props.renderItem - per-item render function.
 * @param props.getKey - stable id extractor. Optional: when omitted, a
 * primitive item (string/number) keys by its own
 * value (stable across reorders); only non-primitive
 * items with no extractor fall back to the row index.
 * @param props.estimateSize - initial size guess (px) per row. Default 200.
 * @param props.overscan - off-screen buffer rows. Default 5.
 * @param props.height - viewport height in CSS (any valid value).
 * Default `60vh`; caller can override.
 * @param props.className - extra classes on the scroll container.
 */
export function VirtualizedList<T>({
  items,
  renderItem,
  getKey,
  estimateSize = 200,
  overscan = 5,
  height = "60vh",
  className = "",
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey?: (item: T, index: number) => string | number;
  estimateSize?: number;
  overscan?: number;
  height?: string;
  className?: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  /*
   * Resolve a stable React key for a row. Prefer the caller's `getKey`; when
   * it's absent, a primitive item keys by its own value (so a reordered string
   * list still reconciles by identity), and only a non-primitive item with no
   * extractor falls back to the row index as a last resort.
   */
  const keyFor = (item: T, index: number): string | number => {
    if (getKey) return getKey(item, index);
    const t = typeof item;
    return t === "string" || t === "number"
      ? (item as unknown as string | number)
      : index;
  };

  return (
    <div
      ref={parentRef}
      className={`overflow-auto ${className}`}
      style={{ height, contain: "strict" }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          return (
            <div
              key={keyFor(item, virtualRow.index)}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Threshold above which we switch from plain `.map()` to a virtualized
 * window. Exported so consumer pages can pick the same number to keep
 * UX consistent.
 *
 * Set to 20 so the virtualized path is actually reachable: VideosPage
 * fetches `pageSize: 24`, so a full page of videos now exceeds the
 * threshold and exercises the windowed renderer (with 25 it never could,
 * leaving that branch effectively dead). Smaller pages (Evidence's 12)
 * still take the plain-map path, which is what we want below the threshold.
 */
export const VIRTUALIZE_THRESHOLD = 20;
