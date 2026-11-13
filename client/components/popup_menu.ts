import { placePopupMenu, placeSubmenu } from "./menu_placement.ts";

/** SVG markup, a ready node, or one made when the row renders */
export type PopupIcon = string | Node | (() => string | Node);

export type PopupEntry<Id extends string = string> =
  | { kind: "info"; text: string }
  | { kind: "separator" }
  | ({
      kind: "item";
      label: string;
      icon: PopupIcon;
      current?: boolean;
      /** Why it can't be picked now: shown greyed out, as its tooltip */
      disabled?: string;
      /** Trailing, right-aligned hint, e.g. the item's keyboard shortcut */
      hint?: string;
    } & (
      | {
          /** What `onPick` gets, unless there is a `run` */
          id: Id;
          /** Picking it: called instead of `onPick` */
          run?: () => void;
        }
      | {
          id?: undefined;
          run: () => void;
        }
    ))
  | {
      /** A row that opens a menu of `entries` beside it */
      kind: "submenu";
      label: string;
      icon: PopupIcon;
      entries: PopupEntry<Id>[];
    };

// Feather "chevron-right", the submenu row's trailing marker
const SUBMENU_CHEVRON =
  '<svg class="sb-dock-menu-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';

export type PopupMenuOptions<Id extends string = string> = {
  /** Called with a picked item's id, unless the item has its own `run` */
  onPick?: (id: Id) => void;
  /** Extra classes on each menu (top and submenus) */
  className?: string;
  /** Which edge of the anchor the menu lines up with */
  align?: "start" | "end";
  /**
   * Called once the menu has closed, however it closed: a pick (after the
   * pick has run), Escape (after the anchor is refocused), an outside click,
   * focus leaving, a scroll, another popup opening or the returned function
   */
  onClose?: () => void;
};

let closeOpen: (() => void) | undefined;
let openAnchor: HTMLElement | undefined;

/**
 * `openPopupMenu`, except that when this anchor's menu is already open it
 * closes it instead (a button that toggles its menu). Returns the menu's close
 * function, like `openPopupMenu`.
 */
export function togglePopupMenu<Id extends string>(
  anchor: HTMLElement,
  entries: PopupEntry<Id>[],
  options: PopupMenuOptions<Id> = {},
): () => void {
  if (openAnchor === anchor && closeOpen) {
    const close = closeOpen;
    close();
    return close;
  }
  return openPopupMenu(anchor, entries, options);
}

/**
 * Opens a menu under `anchor`, closing any other popup menu; returns its close
 * function. A submenu entry opens its own menu beside its row on hover, Enter,
 * Space or →; ← or Escape closes it back to the row.
 */
export function openPopupMenu<Id extends string>(
  anchor: HTMLElement,
  entries: PopupEntry<Id>[],
  options: PopupMenuOptions<Id> = {},
): () => void {
  const { onPick, className = "", align = "end", onClose } = options;
  closeOpen?.();
  // The open menus: the top one, then each open submenu
  const levels: { menu: HTMLElement; row?: HTMLElement }[] = [];
  const inMenus = (node: Node) =>
    levels.some(({ menu }) => menu.contains(node));

  /**
   * Closes the submenus from `level` on. Focus goes back to the row of the
   * first when asked, or when it was inside one of them (it would drop to
   * the page otherwise).
   */
  function closeFrom(level: number, refocus = false) {
    if (level >= levels.length) return;
    const row = levels[level].row;
    const active = document.activeElement;
    const hadFocus =
      !!active && levels.slice(level).some(({ menu }) => menu.contains(active));
    if (refocus || hadFocus) row?.focus({ preventScroll: true });
    for (const { menu, row } of levels.splice(level)) {
      menu.remove();
      row?.setAttribute("aria-expanded", "false");
    }
  }

  function openSubmenu(
    level: number,
    row: HTMLElement,
    children: PopupEntry<Id>[],
    focus: boolean,
  ) {
    if (levels[level + 1]?.row !== row) {
      closeFrom(level + 1);
      const menu = render(children, level + 1);
      levels.push({ menu, row });
      row.setAttribute("aria-expanded", "true");
      const pos = placeSubmenu(
        row.getBoundingClientRect(),
        levels[level].menu.getBoundingClientRect(),
        { width: menu.offsetWidth, height: menu.offsetHeight },
        { width: globalThis.innerWidth, height: globalThis.innerHeight },
      );
      menu.style.top = `${pos.top}px`;
      menu.style.left = `${pos.left}px`;
      menu.style.visibility = "";
    }
    if (focus) {
      levels[level + 1].menu
        .querySelector<HTMLElement>("[role=menuitem]")
        ?.focus({ preventScroll: true });
    }
  }

  function render(list: PopupEntry<Id>[], level: number): HTMLElement {
    const menu = document.createElement("div");
    menu.className = `sb-dock-menu ${className}`.trim();
    menu.setAttribute("role", "menu");
    menu.style.visibility = "hidden";
    for (const entry of list) {
      if (entry.kind === "info") {
        const info = document.createElement("div");
        info.className = "sb-widget-menu-info";
        info.textContent = entry.text;
        menu.append(info);
        continue;
      }
      if (entry.kind === "separator") {
        const sep = document.createElement("div");
        sep.className = "sb-widget-menu-separator";
        sep.setAttribute("role", "separator");
        menu.append(sep);
        continue;
      }
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.className = "sb-dock-menu-item";
      const icon = typeof entry.icon === "function" ? entry.icon() : entry.icon;
      if (typeof icon === "string") item.innerHTML = icon;
      else item.append(icon);
      const label = document.createElement("span");
      label.textContent = entry.label;
      item.append(label);
      if (entry.kind === "submenu") {
        item.classList.add("sb-dock-menu-submenu");
        item.setAttribute("aria-haspopup", "menu");
        item.setAttribute("aria-expanded", "false");
        item.insertAdjacentHTML("beforeend", SUBMENU_CHEVRON);
        item.addEventListener("mouseenter", () =>
          openSubmenu(level, item, entry.entries, false),
        );
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          openSubmenu(level, item, entry.entries, true);
        });
        menu.append(item);
        continue;
      }
      if (entry.current) item.classList.add("sb-dock-menu-current");
      if (entry.id !== undefined) item.dataset.action = entry.id;
      if (entry.hint) {
        const hint = document.createElement("span");
        hint.className = "sb-dock-menu-hint";
        hint.textContent = entry.hint;
        item.append(hint);
      }
      if (entry.disabled) {
        // aria-disabled rather than disabled, so it still shows its tooltip and takes focus
        item.setAttribute("aria-disabled", "true");
        item.title = entry.disabled;
      }
      // Pointing at another row closes a submenu opened from this menu
      item.addEventListener("mouseenter", () => closeFrom(level + 1));
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        if (entry.disabled) return;
        close(false, false);
        try {
          if (entry.run) entry.run();
          else if (entry.id !== undefined) onPick?.(entry.id);
        } finally {
          onClose?.();
        }
      });
      menu.append(item);
    }
    menu.addEventListener("keydown", (e) => onKey(e, level, menu));
    menu.addEventListener("focusout", onFocusOut);
    document.body.append(menu);
    return menu;
  }

  const onDown = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!inMenus(target) && !anchor.contains(target)) close();
  };
  const onKey = (e: KeyboardEvent, level: number, menu: HTMLElement) => {
    const focused = document.activeElement as HTMLElement | null;
    // The menu owns the arrows, Home and End, acted on or not: the window's
    // shortcut routing would otherwise hand them to the editor, moving its
    // caret and pulling focus out of the menu
    if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.key === "Escape" || (e.key === "ArrowLeft" && level > 0)) {
      e.preventDefault();
      e.stopPropagation();
      if (level > 0) {
        closeFrom(level, true);
        return;
      }
      close(true);
      return;
    }
    if (
      e.key === "ArrowRight" &&
      focused?.getAttribute("aria-haspopup") === "menu" &&
      menu.contains(focused)
    ) {
      focused.click();
      return;
    }
    // The focused item's own key: its default, a click, picks it (or opens
    // its submenu). Kept from the window's shortcut routing, which runs the
    // editor's Enter otherwise
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
      return;
    }
    const items = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const at = items.indexOf(focused as HTMLElement);
    const next =
      e.key === "ArrowDown"
        ? (at + 1) % items.length
        : e.key === "ArrowUp"
          ? (at - 1 + items.length) % items.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : undefined;
    if (next !== undefined) items[next]?.focus({ preventScroll: true });
  };
  // A fixed menu would otherwise sit still while the page moved under it.
  const onMove = () => close();
  // Only a scroll that moves the anchor counts: an unrelated scroller (or a
  // sideways nudge of a sibling widget) leaves the menu where it belongs.
  const onScroll = (e: Event) => {
    const target = e.target;
    if (target instanceof Node && !target.contains(anchor)) return;
    close();
  };
  // relatedTarget is null when a click lands on something unfocusable (or on a
  // menu item in Safari); outside clicks are handled by onDown instead.
  const onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && !inMenus(next) && !anchor.contains(next)) close();
  };

  let closed = false;
  /**
   * `refocus`: give focus back to the anchor (Escape) before `onClose`;
   * `notify` off: the caller calls `onClose` itself (after a pick runs)
   */
  function close(refocus = false, notify = true) {
    if (closed) return;
    closed = true;
    closeFrom(0);
    // Capture: widget content stops mousedown from bubbling to the editor
    document.removeEventListener("mousedown", onDown, true);
    globalThis.removeEventListener("scroll", onScroll, true);
    globalThis.removeEventListener("resize", onMove);
    anchor.setAttribute("aria-expanded", "false");
    if (closeOpen === closeMenu) {
      closeOpen = undefined;
      openAnchor = undefined;
    }
    if (refocus) anchor.focus();
    if (notify) onClose?.();
  }
  const closeMenu = () => close();

  const menu = render(entries, 0);
  levels.push({ menu });
  document.addEventListener("mousedown", onDown, true);
  globalThis.addEventListener("scroll", onScroll, true);
  globalThis.addEventListener("resize", onMove);
  anchor.setAttribute("aria-expanded", "true");
  closeOpen = closeMenu;
  openAnchor = anchor;

  const pos = placePopupMenu(
    anchor.getBoundingClientRect(),
    { width: menu.offsetWidth, height: menu.offsetHeight },
    { width: globalThis.innerWidth, height: globalThis.innerHeight },
    align,
  );
  menu.style.top = `${pos.top}px`;
  menu.style.left = `${pos.left}px`;
  menu.style.visibility = "";
  menu
    .querySelector<HTMLElement>("[role=menuitem]")
    ?.focus({ preventScroll: true });
  return closeMenu;
}
