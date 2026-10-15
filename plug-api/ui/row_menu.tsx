import { useLayoutEffect, useRef, useState } from "preact/hooks";

export type RowMenuItem = {
  label: string;
  disabled?: boolean;
  run: () => void;
};

export type RowMenuProps = {
  /** The trigger's accessible name: "Actions for Garden". */
  label: string;
  items: RowMenuItem[];
};

const GAP = 4;
const GUTTER = 8;

type Placement = { top: number; right: number };

/**
 * A small "⋯" button opening a menu of a row's actions, right-aligned under
 * it. Arrow keys move between the enabled items, Escape closes it back onto
 * the button; a click outside, a scroll or a resize closes it.
 */
export function RowMenu({ label, items }: RowMenuProps) {
  const [open, setOpen] = useState<Placement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(null);
    if (refocus) trigger.current?.focus();
  };
  const enabled = () => [
    ...(menu.current?.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ) ?? []),
  ];

  // Layout, not passive: a click arriving before a deferred effect would
  // find no listener.
  useLayoutEffect(() => {
    if (!open) return;
    const first = enabled()[0] ?? menu.current;
    first?.focus({ preventScroll: true });
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !menu.current?.contains(target) &&
        !trigger.current?.contains(target)
      ) {
        setOpen(null);
      }
    };
    // Placement is measured once, so moving the page would leave it behind.
    const onMove = () => setOpen(null);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("scroll", onMove, true);
    globalThis.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("scroll", onMove, true);
      globalThis.removeEventListener("resize", onMove);
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const buttons = enabled();
      if (!buttons.length) return;
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length].focus();
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        class="sb-button-icon sb-row-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onClick={(e) => {
          if (open) return close(false);
          const rect = e.currentTarget.getBoundingClientRect();
          setOpen({
            top: rect.bottom + GAP,
            right: Math.max(GUTTER, globalThis.innerWidth - rect.right),
          });
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          ref={menu}
          class="sb-row-menu"
          role="menu"
          aria-label={label}
          tabIndex={-1}
          style={{ top: `${open.top}px`, right: `${open.right}px` }}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.run();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
