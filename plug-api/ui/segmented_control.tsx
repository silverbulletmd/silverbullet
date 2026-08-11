import { useRef } from "preact/hooks";
import { Icon } from "./icon.tsx";
import { useFitCollapse } from "./use_fit_collapse.ts";

export type SegmentItem = {
  label: string;
  icon?: Element;
  tooltip?: string;
};

export type SegmentedControlProps = {
  items: SegmentItem[];
  activeIndex: number;
  onPick: (index: number) => void;
  /**
   * Whether picking an item takes keyboard focus. Default `false`: the
   * control stays out of the tab order and a mousedown never steals focus,
   * for a caller whose own input (e.g. a phrase box) is meant to keep it
   * throughout. Pass `true` for a control with no such input to defer to.
   */
  takeFocus?: boolean;
  ariaLabel?: string;
};

/**
 * A row of mutually-exclusive options, radiogroup-style. The control gives
 * things up in order as its wrapper narrows -- a 180px sidebar and a modal
 * are the same control:
 *
 * 1. `full`: icon and label.
 * 2. `icons`: iconed items drop their labels (kept as tooltip and accessible
 *    name); label-only items are never collapsed to nothing.
 *
 * Wrapping onto a second line is the last resort below both (see the
 * stylesheet), and is taken *before* the control would otherwise overflow.
 */
export function SegmentedControl({
  items,
  activeIndex,
  onPick,
  takeFocus = false,
  ariaLabel = "Options",
}: SegmentedControlProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Only iconed items can collapse, so a control of label-only items never
  // measures as narrow-able. Re-measured from scratch when either changes.
  const signature =
    items.map((i) => i.label).join(" ") +
    `|${items.filter((i) => i.icon).length}`;

  const fit = useFitCollapse(wrapRef, barRef, signature);
  const narrow = fit !== "full";

  return (
    <div class="sb-segments-wrap" ref={wrapRef}>
      <div
        ref={barRef}
        role="radiogroup"
        aria-label={ariaLabel}
        class={"sb-segments" + (narrow ? " sb-segments-narrow" : "")}
      >
        {items.map((item, index) => (
          <button
            key={item.label}
            type="button"
            class={
              "sb-segment" +
              (item.icon ? " sb-segment-iconed" : "") +
              (index === activeIndex ? " sb-segment-active" : "")
            }
            tabIndex={takeFocus ? 0 : -1}
            role="radio"
            aria-checked={index === activeIndex}
            // The label only where it isn't already rendered -- a tooltip
            // repeating text the user can read is noise.
            title={
              item.tooltip ?? (narrow && item.icon ? item.label : undefined)
            }
            aria-label={item.label}
            onMouseDown={takeFocus ? undefined : (e) => e.preventDefault()}
            onClick={() => onPick(index)}
          >
            {item.icon && <Icon node={item.icon} class="sb-segment-icon" />}
            <span class="sb-segment-label">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
