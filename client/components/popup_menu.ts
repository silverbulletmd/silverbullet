import { placePopupMenu } from "./menu_placement.ts";

export type PopupEntry<Id extends string = string> =
  | { kind: "info"; text: string }
  | { kind: "separator" }
  | {
      kind: "item";
      id: Id;
      label: string;
      // SVG markup, or a ready node
      icon: string | Node;
      current?: boolean;
    };

let closeOpen: (() => void) | undefined;

/** Opens a menu under `anchor`, closing any other popup menu; returns its close function. */
export function openPopupMenu<Id extends string>(
  anchor: HTMLElement,
  entries: PopupEntry<Id>[],
  onPick: (id: Id) => void,
  className = "",
): () => void {
  closeOpen?.();
  const menu = document.createElement("div");
  menu.className = `sb-dock-menu ${className}`.trim();
  menu.setAttribute("role", "menu");
  menu.style.visibility = "hidden";
  for (const entry of entries) {
    if (entry.kind === "info") {
      const info = document.createElement("div");
      info.className = "sb-widget-menu-info";
      info.textContent = entry.text;
      menu.append(info);
    } else if (entry.kind === "separator") {
      const sep = document.createElement("div");
      sep.className = "sb-widget-menu-separator";
      sep.setAttribute("role", "separator");
      menu.append(sep);
    } else {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.className = `sb-dock-menu-item${entry.current ? " sb-dock-menu-current" : ""}`;
      item.dataset.action = entry.id;
      if (typeof entry.icon === "string") item.innerHTML = entry.icon;
      else item.append(entry.icon);
      const label = document.createElement("span");
      label.textContent = entry.label;
      item.append(label);
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        close();
        onPick(entry.id);
      });
      menu.append(item);
    }
  }
  document.body.append(menu);
  const items = [...menu.querySelectorAll<HTMLElement>("[data-action]")];

  const onDown = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!menu.contains(target) && !anchor.contains(target)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      anchor.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus({
      preventScroll: true,
    });
  };
  // A fixed menu would otherwise sit still while the page moved under it.
  const onMove = () => close();
  // relatedTarget is null when a click lands on something unfocusable (or on a
  // menu item in Safari); outside clicks are handled by onDown instead.
  const onFocusOut = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && !menu.contains(next) && !anchor.contains(next)) close();
  };

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    menu.remove();
    // Capture: widget content stops mousedown from bubbling to the editor
    document.removeEventListener("mousedown", onDown, true);
    menu.removeEventListener("keydown", onKey);
    menu.removeEventListener("focusout", onFocusOut);
    globalThis.removeEventListener("scroll", onMove, true);
    globalThis.removeEventListener("resize", onMove);
    anchor.setAttribute("aria-expanded", "false");
    if (closeOpen === close) closeOpen = undefined;
  }

  document.addEventListener("mousedown", onDown, true);
  menu.addEventListener("keydown", onKey);
  menu.addEventListener("focusout", onFocusOut);
  globalThis.addEventListener("scroll", onMove, true);
  globalThis.addEventListener("resize", onMove);
  anchor.setAttribute("aria-expanded", "true");
  closeOpen = close;

  const pos = placePopupMenu(
    anchor.getBoundingClientRect(),
    { width: menu.offsetWidth, height: menu.offsetHeight },
    { width: globalThis.innerWidth, height: globalThis.innerHeight },
  );
  menu.style.top = `${pos.top}px`;
  menu.style.left = `${pos.left}px`;
  menu.style.visibility = "";
  items[0]?.focus({ preventScroll: true });
  return close;
}
