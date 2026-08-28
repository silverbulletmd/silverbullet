import type { JSX } from "preact";
import { CHROME_ICON_PROPS } from "./chrome_icons.tsx";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { moveDock } from "../../navigator.ts";

const LABELS: Record<string, string> = {
  "page-top": "Top of page",
  "page-bottom": "Bottom of page",
  lhs: "Left sidebar",
  rhs: "Right sidebar",
  modal: "Modal only",
};

function dockIcon(dock: string) {
  const page = dock === "page-top" || dock === "page-bottom";
  const frame = page ? (
    <rect x="3.5" y="1.5" width="9" height="13" rx="1" />
  ) : (
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
  );
  const fills: Record<string, JSX.Element> = {
    "page-top": <rect x="5" y="3" width="6" height="2.5" rx="0.5" />,
    "page-bottom": <rect x="5" y="10.5" width="6" height="2.5" rx="0.5" />,
    lhs: <rect x="3.5" y="4.5" width="3" height="7" rx="0.5" />,
    rhs: <rect x="9.5" y="4.5" width="3" height="7" rx="0.5" />,
    modal: <rect x="4.5" y="5" width="7" height="4.5" rx="0.5" />,
  };
  return (
    <svg viewBox="0 0 16 16" {...CHROME_ICON_PROPS}>
      {frame}
      <g fill="currentColor" stroke="none">
        {fills[dock]}
      </g>
    </svg>
  );
}

export function DockMenu({
  name,
  current,
  supported,
}: {
  name: string;
  current: string;
  supported: string[];
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | undefined>(
    undefined,
  );
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(undefined);
      return;
    }
    const button = ref.current?.querySelector("button");
    const menu = menuRef.current;
    if (!button || !menu) return;
    const b = button.getBoundingClientRect();
    const { offsetHeight: h, offsetWidth: w } = menu;
    const GAP = 4;
    const EDGE = 8;
    // Below the button, or above it when there is no room below.
    const below = b.bottom + GAP;
    const top =
      below + h > globalThis.innerHeight - EDGE
        ? Math.max(EDGE, b.top - GAP - h)
        : below;
    // Right-aligned to the button, kept inside the viewport either way.
    const left = Math.max(
      EDGE,
      Math.min(b.right - w, globalThis.innerWidth - w - EDGE),
    );
    setPos({ top, left });
  }, [open]);

  // A fixed menu would otherwise sit still while the page moved under it.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    globalThis.addEventListener("scroll", close, true);
    globalThis.addEventListener("resize", close);
    return () => {
      globalThis.removeEventListener("scroll", close, true);
      globalThis.removeEventListener("resize", close);
    };
  }, [open]);
  if (supported.length < 2) return null;
  return (
    <div className="sb-dock-menu-anchor" ref={ref}>
      <button
        type="button"
        className="sb-dock-button"
        title={`Shown as: ${LABELS[current]}. Change placement`}
        aria-label={`Shown as: ${LABELS[current]}. Change placement`}
        onClick={() => setOpen(!open)}
      >
        {dockIcon(current)}
      </button>
      {open && (
        <div
          className="sb-dock-menu"
          role="menu"
          ref={menuRef}
          // Hidden for the single frame between mounting (which is what makes
          // it measurable) and being placed, so it never flashes at 0,0.
          style={
            pos
              ? { top: `${pos.top}px`, left: `${pos.left}px` }
              : { visibility: "hidden" }
          }
        >
          {supported.map((dock) => (
            <button
              type="button"
              role="menuitem"
              key={dock}
              className={`sb-dock-menu-item${dock === current ? " sb-dock-menu-current" : ""}`}
              onClick={() => {
                setOpen(false);
                if (dock !== current) void moveDock(name, dock);
              }}
            >
              {dockIcon(dock)}
              <span>{LABELS[dock]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
