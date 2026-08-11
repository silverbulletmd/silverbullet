import { useLayoutEffect, useRef, useState } from "preact/hooks";

export type FitLevel = "full" | "icons";

/**
 * Measures whether a row of items (buttons in `barRef`, inside `wrapRef`)
 * fits at full width, collapsing to `"icons"` when it doesn't.
 *
 * The fit is measured rather than guessed at a breakpoint: how wide the bar
 * wants to be depends on its items' own labels, which no `@container`
 * condition can express. The measurement happens on layout, only when the
 * wrapper actually resizes or `signature` changes -- never per frame.
 *
 * `signature` should change whenever the set of items (or which of them carry
 * icons) changes, so a fresh full-width measurement is taken rather than
 * reusing one from a different set of items.
 */
export function useFitCollapse(
  wrapRef: { current: HTMLElement | null },
  barRef: { current: HTMLElement | null },
  signature: string,
): FitLevel {
  const [fit, setFit] = useState<FitLevel>("full");
  // The full-width rendering's own width, recorded while it's on screen: a
  // collapsed bar can no longer be asked what the fuller one wanted, and this
  // is what lets a widened wrapper snap straight back to "full" instead of
  // staying collapsed until something else forces a re-measure.
  const fullWidth = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    fullWidth.current = undefined;
    setFit("full");
  }, [signature]);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const wrap = wrapRef.current;
    if (!bar || !wrap) return;
    const measure = () => {
      // Summed rather than read off the bar: it may wrap as a last resort,
      // and a wrapped bar reports the width it settled for, never the width
      // it wanted.
      const style = getComputedStyle(bar);
      const items = [...bar.children] as HTMLElement[];
      const gaps =
        (parseFloat(style.columnGap) || 0) * Math.max(0, items.length - 1);
      const padding =
        (parseFloat(style.paddingLeft) || 0) +
        (parseFloat(style.paddingRight) || 0);
      const wanted =
        items.reduce((sum, s) => sum + s.getBoundingClientRect().width, 0) +
        gaps +
        padding;
      if (fit === "full") fullWidth.current = wanted;

      const available = wrap.clientWidth;
      const full = fullWidth.current;
      setFit(full !== undefined && full > available ? "icons" : "full");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [fit, signature]);

  return fit;
}
