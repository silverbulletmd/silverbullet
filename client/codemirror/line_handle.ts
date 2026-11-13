// The line handle: a ⋮ button in the left padding, beside the line or the
// widget card under the mouse, that opens a menu of what fits that line
// (`line_menu.ts`) or that widget (`widgets/block_menu.ts`), placed by
// `line_geometry.ts`
import type { Extension } from "@codemirror/state";
import { BlockType, type EditorView, ViewPlugin } from "@codemirror/view";
import type { Client } from "../client.ts";
import { openPopupMenu, type PopupEntry } from "../components/popup_menu.ts";
import { markupSurfaces } from "../lib/markup_buttons.ts";
import {
  cardPlacement,
  handlePlacement,
  lineElement,
  lineIsReplaced,
  textLeftEdge,
} from "./line_geometry.ts";
import {
  fetchTaskStates,
  type LineMenuOptions,
  lineMenuEntries,
  selectionForPick,
  taskStateOn,
} from "./line_menu.ts";
import {
  blockWidgetAround,
  inlineWidgets,
  joinGroups,
  WIDGET_MENU_ATTR,
  widgetMenuEntriesFor,
  widgetMenuSource,
  widgetSubmenus,
} from "./widgets/block_menu.ts";

/** What the handle is beside: a line of text, or a widget's card */
type Target =
  | { line: number; card?: undefined }
  | { card: HTMLElement; line?: undefined };

const sameTarget = (a?: Target, b?: Target) =>
  a === b ||
  (!!a && !!b && (a.card ? a.card === b.card : !b.card && a.line === b.line));

/** The card the pointer is over or beside in the margin, if any */
function cardUnder(
  view: EditorView,
  e: PointerEvent,
  current: HTMLElement | undefined,
): HTMLElement | undefined {
  const target = e.target instanceof Element ? e.target : undefined;
  const over = target && blockWidgetAround(target, view.contentDOM);
  if (over) return over;
  // Heading for its ⋮: left of the card, level with it
  if (current?.isConnected) {
    const r = current.getBoundingClientRect();
    if (e.clientY >= r.top && e.clientY < r.bottom && e.clientX < r.left) {
      return current;
    }
  }
  // In the left padding, level with a card that starts at the text's edge
  const textLeft = textLeftEdge(view);
  if (
    e.clientX >= textLeft ||
    !view.contentDOM.querySelector(`[${WIDGET_MENU_ATTR}]`)
  ) {
    return;
  }
  const probe = document.elementFromPoint(textLeft + 1, e.clientY);
  return probe ? blockWidgetAround(probe, view.contentDOM) : undefined;
}

// Feather "more-vertical"
const HANDLE_ICON =
  '<svg class="sb-line-handle-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>';

/**
 * The line handle: a ⋮ button in the left padding, level with the first
 * visual row of the line under the mouse, or with the top of the widget card
 * under it, at once; never because of the text cursor. It hides as soon as
 * the mouse leaves the lines or the user types, unless it is hovered, focused
 * or its menu is open. An overlay, so it reserves no space. Clicking it opens
 * the line's menu (`lineMenuEntries`, plus a section per inline widget on the
 * line) or the card's (`widgetMenuEntriesFor`). Only where `markupSurfaces`
 * turns on a menu source: text-line menus on desktop, never in a read-only
 * editor; widget menus on desktop, read-only too.
 */
export function lineHandlePlugin(client: Client): Extension {
  return ViewPlugin.define((view) => {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "sb-line-handle";
    handle.innerHTML = HANDLE_ICON;
    handle.title = "Line actions";
    handle.setAttribute("aria-label", "Line actions");
    handle.setAttribute("aria-haspopup", "menu");
    handle.setAttribute("aria-expanded", "false");
    handle.hidden = true;
    handle.tabIndex = -1;
    handle.setAttribute("aria-hidden", "true");
    // What the handle stays on while it has focus or its menu is open, a
    // line mapped through edits
    let pinned: Target | undefined;
    // The line or card under the mouse
    let hovered: Target | undefined;
    let shown: Target | undefined;
    let handleHovered = false;
    let menuOpen = false;
    const available = () => {
      const surfaces = markupSurfaces(client, view.state);
      return surfaces.line || surfaces.addTag || surfaces.widget;
    };
    const widgetsOn = () => markupSurfaces(client, view.state).widget;
    // A line's menu, rendered as `el`: its own, then a section per inline
    // widget on it (a `${…}` in a sentence), acting on the widget, not the
    // line; block cards have their own ⋮. A line has a handle when it is
    // non-empty.
    const lineMenu = (
      n: number,
      el: HTMLElement | undefined,
      options?: LineMenuOptions,
    ) =>
      joinGroups([
        lineMenuEntries(client, view.state, n, options),
        widgetsOn() && el ? widgetSubmenus(client, inlineWidgets(el)) : [],
      ]);

    const show = () =>
      view.requestMeasure({
        key: handle,
        read: () => {
          if (!available()) return;
          // Where the mouse is; an open menu or focus pins it
          const target = pinned ?? hovered;
          if (!target) return;
          const width = handle.offsetWidth || 18;
          if (target.card) {
            const { card } = target;
            if (!widgetsOn() || !card.isConnected) return;
            if (!widgetMenuEntriesFor(client, card).length) return;
            return { target, at: cardPlacement(view, card, width) };
          }
          const n = target.line;
          if (n > view.state.doc.lines) return;
          const line = view.state.doc.line(n);
          const el = lineElement(view, line);
          if (lineIsReplaced(view, line, el)) return;
          if (!lineMenu(n, el).length) return;
          return { target, at: handlePlacement(view, line, el, width) };
        },
        write: (result) => {
          shown = result?.at ? result.target : undefined;
          // Faded out, it is out of the tab order and the accessibility tree
          handle.tabIndex = shown === undefined ? -1 : 0;
          handle.title = shown?.card ? "Widget actions" : "Line actions";
          handle.setAttribute("aria-label", handle.title);
          if (shown === undefined) {
            handle.setAttribute("aria-hidden", "true");
          } else {
            handle.removeAttribute("aria-hidden");
          }
          if (!result) {
            // Fade out where it is; gone altogether when unavailable
            handle.classList.remove("sb-line-handle-shown");
            delete handle.dataset.line;
            delete handle.dataset.widget;
            if (!available()) handle.hidden = true;
            return;
          }
          const { at } = result;
          if (!at) {
            handle.hidden = true;
            return;
          }
          handle.style.left = `${at.left}px`;
          handle.style.top = `${at.top}px`;
          handle.style.height = `${at.height}px`;
          if (result.target.card) {
            delete handle.dataset.line;
            handle.dataset.widget =
              widgetMenuSource(result.target.card)?.label ?? "";
          } else {
            delete handle.dataset.widget;
            handle.dataset.line = String(result.target.line);
          }
          if (handle.hidden) {
            handle.hidden = false;
            // Start the fade from the faded-out state
            void handle.offsetWidth;
          }
          handle.classList.add("sb-line-handle-shown");
        },
      });

    // Over a widget's card, or a line of text (line 1 includes the padding
    // above it), with a mouse
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (e.target instanceof Node && handle.contains(e.target)) return;
      const card = widgetsOn() ? cardUnder(view, e, hovered?.card) : undefined;
      if (card) {
        if (hovered?.card === card) return;
        hovered = { card };
        show();
        return;
      }
      let next: number | undefined;
      const line1Bottom = view.documentTop + view.lineBlockAt(0).bottom;
      const top = view.scrollDOM.getBoundingClientRect().top;
      if (e.clientY >= top && e.clientY <= line1Bottom) {
        next = 1;
      } else if (
        // Not the empty space below the last line: elementAtHeight clamps
        e.clientY <=
        view.documentTop + view.lineBlockAt(view.state.doc.length).bottom
      ) {
        const block = view.elementAtHeight(e.clientY - view.documentTop);
        if (block.type === BlockType.Text) {
          next = view.state.doc.lineAt(block.from).number;
        }
      }
      const target = next === undefined ? undefined : { line: next };
      if (sameTarget(target, hovered)) return;
      hovered = target;
      show();
    };
    const unhover = () => {
      if (hovered === undefined) return;
      hovered = undefined;
      show();
    };
    // Typing in the editor hides it, unless the mouse is on the handle
    const onType = () => {
      if (!handleHovered) unhover();
    };

    let opening = false;
    // Opened from the keyboard on the focused handle: closing it leaves focus
    // there, so it can be opened again; else focus goes back to the editor
    let fromKeyboard = false;
    // A picked entry acts on the pinned line, wherever edits have moved it
    const onRun = (run: () => void) => {
      const n = pinned?.line;
      if (n === undefined || n > view.state.doc.lines) return;
      const selection = selectionForPick(view.state, n);
      if (selection) view.dispatch({ selection });
      view.focus();
      run();
    };
    // However the menu closed (after a pick has run)
    const onClose = () => {
      menuOpen = false;
      if (handle === document.activeElement) {
        if (fromKeyboard) return;
        // Escape refocuses the menu's anchor; a pointer user goes back to
        // the page, with the handle free to follow the pointer again
        view.focus();
      }
      pinned = undefined;
      show();
    };
    const open = (target: Target, entries: PopupEntry[]) => {
      if (entries.length === 0) return;
      pinned = target;
      menuOpen = true;
      openPopupMenu(handle, entries, {
        className: "sb-widget-menu",
        // Drops down over the page, not leftwards over the sidebar
        align: "start",
        onClose,
      });
    };
    const openMenu = async (keyboard: boolean) => {
      if (menuOpen || opening) return;
      fromKeyboard = keyboard;
      const target = shown;
      if (!target) return;
      if (target.card) {
        open(target, widgetMenuEntriesFor(client, target.card));
        return;
      }
      const n = target.line;
      // The custom task states come from the index, for a task's Set state
      let taskStates: string[] = [];
      if (taskStateOn(view.state, view.state.doc.line(n))) {
        opening = true;
        try {
          taskStates = await fetchTaskStates(client);
        } finally {
          opening = false;
        }
        if (shown?.line !== n || n > view.state.doc.lines) return;
      }
      const el = lineElement(view, view.state.doc.line(n));
      open(target, lineMenu(n, el, { taskStates, onRun }));
    };

    view.scrollDOM.addEventListener("pointermove", onMove);
    // Also when a line comes under a still pointer, e.g. as a menu closes
    view.scrollDOM.addEventListener("pointerover", onMove);
    view.scrollDOM.addEventListener("pointerleave", unhover);
    view.contentDOM.addEventListener("keydown", onType);
    handle.addEventListener("pointerenter", () => {
      handleHovered = true;
    });
    handle.addEventListener("pointerleave", () => {
      handleHovered = false;
    });
    handle.addEventListener("focus", () => {
      pinned ??= shown;
    });
    handle.addEventListener("blur", () => {
      if (menuOpen) return;
      pinned = undefined;
      show();
    });
    // Keep the editor's own mouse handling and selection out of it
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    handle.addEventListener("click", (e) => {
      e.stopPropagation();
      void openMenu(false);
    });
    // The editor would otherwise take Enter and Space as typing: the button
    // sits inside its scroller
    handle.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      void openMenu(true);
    });
    view.scrollDOM.appendChild(handle);
    show();

    return {
      update(update) {
        if (update.docChanged) {
          const mapLine = (line: number) =>
            update.state.doc.lineAt(
              update.changes.mapPos(
                update.startState.doc.line(
                  Math.min(line, update.startState.doc.lines),
                ).from,
              ),
            ).number;
          if (hovered?.line !== undefined) {
            hovered = { line: mapLine(hovered.line) };
          }
          if (pinned?.line !== undefined) {
            pinned = { line: mapLine(pinned.line) };
          }
          if (
            update.transactions.some(
              (tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"),
            )
          ) {
            onType();
          }
        }
        // A revealed marker moves the line's text with the selection
        if (
          update.docChanged ||
          update.selectionSet ||
          update.focusChanged ||
          update.geometryChanged ||
          update.viewportChanged
        ) {
          show();
        }
      },
      destroy() {
        view.scrollDOM.removeEventListener("pointermove", onMove);
        view.scrollDOM.removeEventListener("pointerover", onMove);
        view.scrollDOM.removeEventListener("pointerleave", unhover);
        view.contentDOM.removeEventListener("keydown", onType);
        handle.remove();
      },
    };
  });
}
