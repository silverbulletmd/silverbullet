import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Decoration } from "./tree_types.ts";

export function Chip({ decoration }: { decoration: Decoration }) {
  return (
    <span
      className={"sb-nav-chip " + (decoration.cssClass ?? "")}
      title={decoration.title}
    >
      {decoration.text ?? decoration.icon}
    </span>
  );
}

export function TrailingChips({ decorations }: { decorations: Decoration[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const widths = useRef<number[]>();
  const [visibleCount, setVisibleCount] = useState(decorations.length);
  const signature = decorations
    .map((decoration) =>
      [
        decoration.text,
        decoration.icon,
        decoration.cssClass,
        decoration.title,
      ].join("\u0000"),
    )
    .join("\u0001");

  useLayoutEffect(() => {
    widths.current = undefined;
    setVisibleCount(decorations.length);
  }, [decorations.length, signature]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      if (!widths.current && visibleCount === decorations.length) {
        widths.current = [...element.children].map(
          (child) => child.getBoundingClientRect().width,
        );
      }
      if (!widths.current) return;
      const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
      let used = 0;
      let count = 0;
      for (const width of widths.current) {
        const next = used + (count > 0 ? gap : 0) + width;
        if (next > element.clientWidth + 0.5) break;
        used = next;
        count++;
      }
      setVisibleCount((current) => (current === count ? current : count));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [decorations.length, signature, visibleCount]);

  return (
    <span ref={ref} className="sb-nav-trailing">
      {decorations.slice(0, visibleCount).map((decoration, index) => (
        <Chip key={index} decoration={decoration} />
      ))}
    </span>
  );
}
