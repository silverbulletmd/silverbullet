// The selection bubble: a small row of formatting buttons over a text
// selection, on desktop
import { completionStatus } from "@codemirror/autocomplete";
import { EditorSelection, type Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { h, render } from "preact";
import type { Client } from "../client.ts";
import {
  buttonHint,
  buttonLabel,
  markupButtons,
  markupSurfaces,
  runMarkupButton,
} from "../lib/markup_buttons.ts";
import { MarkupIcon } from "../lib/markup_icons.ts";
import { contextsAt, matchesNodeContexts } from "../lib/node_contexts.ts";

/** Kept between the bubble and the viewport edges */
const EDGE = 8;

/**
 * The x the bubble centers on: the middle of the selected text on the
 * selection's first visual row, from its left edge to `right` (the selection's
 * end, or the end of that row when the selection runs on). Just `left` when
 * `right` is unknown or not right of it.
 */
export function selectionCenterX(left: number, right?: number): number {
  return right === undefined || right <= left ? left : (left + right) / 2;
}

/**
 * Where the bubble goes (client coordinates): centered on `left`, 8px above
 * the selection's first row, flipped below it when there is no room above
 * `minTop` (the editor's visible top, below the top bar), and kept 8px inside
 * the viewport and no higher than `minTop`.
 */
export function bubblePosition(
  selTop: { left: number; top: number; bottom: number; minTop?: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number; placement: "above" | "below" } {
  const { minTop = 0 } = selTop;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, max - EDGE));
  const above = selTop.top - size.height - EDGE;
  const placement = above < minTop ? "below" : "above";
  const top = placement === "above" ? above : selTop.bottom + EDGE;
  return {
    left: clamp(
      selTop.left - size.width / 2,
      EDGE,
      viewport.width - size.width,
    ),
    top: clamp(top, Math.max(minTop, EDGE), viewport.height - size.height),
    placement,
  };
}

/**
 * The selection's first visual row, for `bubblePosition`; null when its start
 * is scrolled out of the editor
 */
function measureSelection(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const coords = view.coordsAtPos(from, 1);
  const scroller = view.scrollDOM.getBoundingClientRect();
  if (!coords || coords.bottom < scroller.top || coords.top > scroller.bottom) {
    return null;
  }
  // Not over the top bar, which the editor may scroll under
  const topBar = document.getElementById("sb-top");
  const minTop = Math.max(
    scroller.top,
    topBar ? topBar.getBoundingClientRect().bottom : 0,
  );
  // The selected span of the first visual row: up to the selection's end, or
  // the end of that row when the selection wraps or runs on
  const rowEnd = view.moveToLineBoundary(
    EditorSelection.cursor(from, 1),
    true,
    true,
  ).head;
  const end = view.coordsAtPos(Math.min(to, rowEnd), -1);
  const onFirstRow = end && end.top < coords.bottom && end.bottom > coords.top;
  return {
    left: selectionCenterX(coords.left, onFirstRow ? end.right : undefined),
    top: coords.top,
    bottom: coords.bottom,
    minTop,
  };
}

/**
 * The bubble over the editor's selection: the `markupBar.selection` buttons
 * whose contexts match at the selection's start. Clicking one keeps the
 * editor's focus and selection. Hides on Escape and typing (until the
 * selection next changes), blur, the selection collapsing and the completion
 * popup opening; follows scrolling.
 */
export function selectionBubblePlugin(client: Client): Extension {
  return ViewPlugin.define((view) => {
    const bubble = document.createElement("div");
    bubble.className = "sb-selection-bubble";
    bubble.setAttribute("role", "toolbar");
    bubble.setAttribute("aria-label", "Formatting");
    // Keeps the editor's focus and selection
    bubble.addEventListener("mousedown", (e) => e.preventDefault());

    let pointerDown = false;
    // Escape or typing, until the selection next changes
    let dismissed = false;

    const hide = () => {
      if (!bubble.isConnected) return;
      render(null, bubble);
      bubble.remove();
    };

    const place = () =>
      view.requestMeasure({
        key: bubble,
        read: () => measureSelection(view),
        write: (sel) => {
          if (!bubble.isConnected) return;
          if (!sel) {
            bubble.style.visibility = "hidden";
            return;
          }
          const at = bubblePosition(
            sel,
            { width: bubble.offsetWidth, height: bubble.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight },
          );
          bubble.style.left = `${at.left}px`;
          bubble.style.top = `${at.top}px`;
          bubble.dataset.placement = at.placement;
          bubble.style.visibility = "";
        },
      });

    const refresh = () => {
      const state = view.state;
      const selection = state.selection.main;
      // Cheap gates first: this runs on every editor update
      if (
        selection.empty ||
        dismissed ||
        pointerDown ||
        !view.hasFocus ||
        completionStatus(state) !== null ||
        !markupSurfaces(client, state).selection
      ) {
        return hide();
      }
      const contexts = contextsAt(client, state, selection.from);
      // Keyed by place in the configured list, so a button keeps its element
      // while others come and go
      const matching = markupButtons(client, "selection").flatMap(
        (button, key) =>
          matchesNodeContexts(button, contexts) ? [{ button, key }] : [],
      );
      if (matching.length === 0) return hide();
      render(
        matching.map(({ button, key }) => {
          const label = buttonLabel(button);
          const hint = buttonHint(client, button);
          return h(
            "button",
            {
              type: "button",
              key,
              title: hint ? `${label} (${hint})` : label,
              "aria-label": label,
              onClick: () => runMarkupButton(client, button),
            },
            h(MarkupIcon, { icon: button.icon, size: 16 }),
          );
        }),
        bubble,
      );
      if (!bubble.isConnected) {
        bubble.style.visibility = "hidden";
        document.body.appendChild(bubble);
      }
      place();
    };

    const onPointerDown = () => {
      pointerDown = true;
      refresh();
    };
    const onPointerUp = () => {
      if (!pointerDown) return;
      pointerDown = false;
      refresh();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      dismissed = true;
      refresh();
    };
    const onScroll = () => {
      if (bubble.isConnected) place();
    };

    view.dom.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerUp, true);
    view.dom.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);

    return {
      update(update) {
        if (!update.state.selection.main.eq(update.startState.selection.main)) {
          // A new selection (re-selecting the same text included) is a
          // fresh start
          dismissed = false;
        }
        // After the selection check: typing that keeps a selection (an
        // auto-paired wrap) moves it, and must still dismiss. Other edits (a
        // bubble button's, sync, a plug) don't.
        if (
          update.transactions.some(
            (tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"),
          )
        ) {
          dismissed = true;
        }
        refresh();
      },
      destroy() {
        hide();
        view.dom.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("pointerup", onPointerUp, true);
        document.removeEventListener("pointercancel", onPointerUp, true);
        view.dom.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onScroll);
      },
    };
  });
}
