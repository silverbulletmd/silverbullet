import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { holdHover } from "./hover.ts";
import { Icon } from "./icon.tsx";
import { placePopupMenu } from "./menu_placement.ts";

export type RowMenuItem = {
  label: string;
  /** A pre-built icon node, drawn before the label. */
  icon?: Element;
  disabled?: boolean;
  run: () => void;
};

export type RowMenuProps = {
  /** The trigger's accessible name: "Actions for Garden". */
  label: string;
  items: RowMenuItem[];
  /** The trigger's; -1 keeps it out of the tab order (a panel, say, whose
   * input holds focus and opens it by key instead). */
  tabIndex?: number;
};

const TRIGGER = ".sb-row-menu-trigger";

/** The keys that open the focused or selected row's menu. */
export function isRowMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
}

/**
 * A row's keydown: on the menu key, opens the row's menu and swallows the
 * key. Says whether it did, so the row's own key handling stops there.
 */
export function handleRowMenuKey(e: KeyboardEvent): boolean {
  const row = e.currentTarget as Element | null;
  if (!isRowMenuKey(e) || !row || !openRowMenu(row)) return false;
  e.preventDefault();
  return true;
}

/**
 * Opens the menu of the row `row` is (the menu key), and reports whether it
 * has one. A menu that is open already stays open.
 */
export function openRowMenu(row: Element): boolean {
  const trigger = row.querySelector<HTMLElement>(TRIGGER);
  if (!trigger) return false;
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  return true;
}

/**
 * A small "⋮" button opening a menu of a row's actions, right-aligned under
 * it (above it when there is no room below). Arrow keys move between the
 * enabled items, Escape closes it and hands focus back; a click outside, a
 * scroll or a resize closes it.
 *
 * The menu is a portal on `<body>`, like the dock menu: a row can hide its
 * actions until hovered, mask or clip them, and handles the clicks and keys
 * that bubble up to it -- none of which may reach the menu. While it is open
 * the row stays hovered (`holdHover`), so its actions, the menu included,
 * stay mounted while the pointer travels there.
 */
export function RowMenu({ label, items, tabIndex }: RowMenuProps) {
  // The trigger's box when the menu opened; null while it is closed.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Where focus was when the menu opened: the trigger, or a panel's input.
  const returnFocus = useRef<HTMLElement | null>(null);

  const enabled = () => [
    ...(menu.current?.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ) ?? []),
  ];
  const focusBack = () => {
    const back = returnFocus.current?.isConnected
      ? returnFocus.current
      : trigger.current;
    back?.focus({ preventScroll: true });
  };
  const close = (refocus: boolean) => {
    if (refocus) focusBack();
    setAnchor(null);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // The menu's own keys: whatever handles them further up (a row, the
    // editor's shortcuts) must not act on them as well.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "Home" ||
      e.key === "End"
    ) {
      e.preventDefault();
      e.stopPropagation();
      const buttons = enabled();
      if (!buttons.length) return;
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? buttons.length - 1
            : (at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[next].focus();
    } else if (e.key === "Enter" || e.key === " ") {
      // The focused item's default, a click, picks it.
      e.stopPropagation();
    }
  };

  // Layout, not passive: a click arriving before a deferred effect would
  // find no listener, and the menu must be placed before it is painted.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!anchor || !el) return;
    const doc = el.ownerDocument;
    const view = doc.defaultView ?? globalThis;
    // Placement is measured once, so moving the page would leave it behind.
    const { top, left } = placePopupMenu(anchor, el.getBoundingClientRect(), {
      width: view.innerWidth,
      height: view.innerHeight,
    });
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    (enabled()[0] ?? el).focus({ preventScroll: true });
    const release = holdHover();

    // A click elsewhere puts focus where it lands; any other close hands it
    // back, or it would drop on <body> with the menu.
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!el.contains(target) && !trigger.current?.contains(target)) {
        setAnchor(null);
      }
    };
    const onMove = () => close(el.contains(doc.activeElement));
    // Capture: a row or widget may stop the pointerdown on its way up.
    doc.addEventListener("pointerdown", onPointer, true);
    doc.addEventListener("scroll", onMove, true);
    view.addEventListener("resize", onMove);
    return () => {
      doc.removeEventListener("pointerdown", onPointer, true);
      doc.removeEventListener("scroll", onMove, true);
      view.removeEventListener("resize", onMove);
      release();
      // Unmounted while open (its row went away).
      if (el.contains(doc.activeElement)) focusBack();
    };
  }, [anchor]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        class="sb-button-icon sb-row-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        tabIndex={tabIndex}
        onClick={(e) => {
          // The trigger is in a row whose own click activates it.
          e.stopPropagation();
          if (anchor) return close(false);
          const doc = e.currentTarget.ownerDocument;
          const active = doc.activeElement as HTMLElement | null;
          returnFocus.current = active && active !== doc.body ? active : null;
          setAnchor(e.currentTarget.getBoundingClientRect());
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="1" />
          <circle cx="12" cy="5" r="1" />
          <circle cx="12" cy="19" r="1" />
        </svg>
      </button>
      {anchor &&
        createPortal(
          <div
            ref={menu}
            class="sb-row-menu"
            role="menu"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            // Ours only: Chrome on Windows/Linux fires the menu key's
            // contextmenu on keyup, with focus already in here, and a
            // right-click on the open menu would otherwise put the browser's
            // menu over it.
            onContextMenu={(e) => e.preventDefault()}
          >
            {items.map((item, index) => (
              <button
                key={index}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close(true);
                  item.run();
                }}
              >
                {item.icon && (
                  <Icon node={item.icon} class="sb-row-menu-icon" />
                )}
                {item.label}
              </button>
            ))}
          </div>,
          trigger.current?.ownerDocument.body ?? document.body,
        )}
    </>
  );
}
