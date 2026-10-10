import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { openPopupMenu } from "../../../components/popup_menu.ts";
import { moveDock } from "../../navigator.ts";
import {
  CHROME_ICON_PROPS,
  iconElement,
} from "../../../components/chrome_icons.tsx";

const LABELS: Record<string, string> = {
  "page-top": "Top of page",
  "page-bottom": "Bottom of page",
  lhs: "Left sidebar",
  rhs: "Right sidebar",
  bhs: "Bottom panel",
  modal: "Modal window",
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
    bhs: <rect x="3.5" y="9" width="9" height="2.5" rx="0.5" />,
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
  const close = useRef<() => void>();
  useEffect(() => () => close.current?.(), []);
  if (supported.length < 2) return null;
  return (
    <div className="sb-dock-menu-anchor">
      <button
        type="button"
        className="sb-dock-button"
        title={`Shown as: ${LABELS[current]}. Change placement`}
        aria-label={`Shown as: ${LABELS[current]}. Change placement`}
        aria-haspopup="menu"
        onClick={(e) => {
          const button = e.currentTarget;
          if (button.getAttribute("aria-expanded") === "true") {
            close.current?.();
            return;
          }
          close.current = openPopupMenu(
            button,
            supported.map((dock) => ({
              kind: "item" as const,
              id: dock,
              label: LABELS[dock],
              icon: iconElement(dockIcon(dock)),
              current: dock === current,
            })),
            (dock) => {
              if (dock !== current) void moveDock(name, dock);
            },
          );
        }}
      >
        {dockIcon(current)}
      </button>
    </div>
  );
}
