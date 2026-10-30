// The "add tag" ghost icon left of line 1 on a page without frontmatter
import type { EditorState, Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import type { Client } from "../../client.ts";
import { findFrontmatterBlock } from "./frontmatter_block.ts";
import {
  focusWhenShown,
  hookLookup,
  previewsEnabled,
} from "./object_preview.ts";

/** What the ghost line inserts: frontmatter with an empty `tags` */
export const NEW_FRONTMATTER = "---\ntags:\n---\n";

/**
 * Whether an editable page without frontmatter offers the "add tag" ghost
 * icon beside line 1. Only the default form edits frontmatter, so it
 * goes with liveEdit.frontmatter.
 */
export function frontmatterGhostEnabled(
  state: EditorState,
  client: Client,
): boolean {
  return (
    !findFrontmatterBlock(state) &&
    previewsEnabled(client) &&
    !state.readOnly &&
    !client.isReadOnlyMode() &&
    hookLookup(client, "page")("page") !== undefined
  );
}

/**
 * Inserts empty frontmatter at the top of the page, one undo step. The caret
 * moves with the body, so the form shows rather than the new YAML.
 */
export function insertFrontmatter(view: EditorView): void {
  const changes = view.state.changes({ from: 0, insert: NEW_FRONTMATTER });
  view.dispatch({
    changes,
    selection: view.state.selection.map(changes, 1),
    userEvent: "input",
  });
}

/**
 * Where the ghost icon goes (client coordinates), or undefined when the space
 * left of line 1 is too narrow: right-aligned `gap` left of the leftmost
 * painted text of line 1's first visual row (a revealed heading marker hangs
 * into the padding), as tall as that row.
 */
export function ghostPlacement(options: {
  row: { top: number; bottom: number };
  /** Leftmost painted text on the row */
  textLeft: number;
  /** Leftmost visible editor x */
  bound: number;
  width: number;
  gap?: number;
}): { left: number; top: number; height: number } | undefined {
  const { row, textLeft, bound, width, gap = 4 } = options;
  const left = textLeft - gap - width;
  if (left < bound) return;
  return { left, top: row.top, height: row.bottom - row.top };
}

// The ghost's icon (Feather "tag"), inlined like Object Form's icons
const GHOST_ICON =
  '<svg class="sb-fm-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';

/** The leftmost painted x of line 1's first visual row */
function firstRowTextLeft(
  view: EditorView,
  row: { top: number; bottom: number },
) {
  let left =
    view.contentDOM.getBoundingClientRect().left +
    Number.parseFloat(getComputedStyle(view.contentDOM).paddingLeft);
  const { node } = view.domAtPos(0);
  const line = (node instanceof Element ? node : node.parentElement)?.closest(
    ".cm-line",
  );
  if (!line) return left;
  const range = document.createRange();
  range.selectNodeContents(line);
  for (const rect of range.getClientRects()) {
    const middle = (rect.top + rect.bottom) / 2;
    if (rect.width > 0 && middle >= row.top && middle <= row.bottom) {
      left = Math.min(left, rect.left);
    }
  }
  return left;
}

/**
 * The ghost of a page without frontmatter: a small tag icon in the left padding,
 * level with line 1's first visual row. An overlay, so it reserves no space;
 * shown only while the mouse is over line 1 or the padding above it.
 * Clicking it inserts `tags:` frontmatter.
 */
export function frontmatterGhostPlugin(client: Client): Extension {
  return ViewPlugin.define((view) => {
    const ghost = document.createElement("button");
    ghost.type = "button";
    ghost.className = "sb-fm-add-attr sb-frontmatter-ghost";
    ghost.innerHTML = GHOST_ICON;
    ghost.title = "add tag";
    ghost.setAttribute("aria-label", "add tag");
    let enabled = frontmatterGhostEnabled(view.state, client);
    let hovered = false;

    // The same state on mount and after re-enabling (an undo): in the DOM
    // while enabled, faded out until shown; placing it hides it again when
    // there's no room
    const show = () => {
      const visible = enabled && (hovered || ghost === document.activeElement);
      ghost.hidden = !enabled;
      ghost.classList.toggle("sb-frontmatter-ghost-shown", visible);
      if (visible) place();
    };

    const place = () =>
      view.requestMeasure({
        read: () => {
          if (!enabled) return;
          const line = view.state.doc.line(1);
          const first = view.coordsAtPos(line.from, 1);
          if (!first) return;
          const row = { top: first.top, bottom: first.bottom };
          const scroller = view.scrollDOM.getBoundingClientRect();
          const at = ghostPlacement({
            row,
            textLeft: firstRowTextLeft(view, row),
            bound: scroller.left,
            width: ghost.offsetWidth,
          });
          return (
            at && {
              left: at.left - scroller.left + view.scrollDOM.scrollLeft,
              top: at.top - scroller.top + view.scrollDOM.scrollTop,
              height: at.height,
            }
          );
        },
        write: (at) => {
          ghost.hidden = !at;
          if (!at) return;
          ghost.style.left = `${at.left}px`;
          ghost.style.top = `${at.top}px`;
          ghost.style.height = `${at.height}px`;
        },
      });

    // Over line 1 or the padding above it, with a mouse
    const onMove = (e: PointerEvent) => {
      if (!enabled || e.pointerType !== "mouse") return;
      const line1Bottom = view.documentTop + view.lineBlockAt(0).bottom;
      const top = view.scrollDOM.getBoundingClientRect().top;
      const over =
        e.target === ghost || (e.clientY >= top && e.clientY <= line1Bottom);
      if (over !== hovered) {
        hovered = over;
        show();
      }
    };
    const onLeave = () => {
      if (!hovered) return;
      hovered = false;
      show();
    };
    view.scrollDOM.addEventListener("pointermove", onMove);
    view.scrollDOM.addEventListener("pointerleave", onLeave);
    ghost.addEventListener("focus", show);
    ghost.addEventListener("blur", show);
    // Keep the editor's own mouse handling and selection out of it
    ghost.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    const activate = () => {
      // The page may have frontmatter by now (the update is still to come)
      if (!frontmatterGhostEnabled(view.state, client)) return;
      insertFrontmatter(view);
      hovered = false;
      show();
      focusWhenShown(
        view,
        0,
        '.sb-fm-row[data-key="tags"] input, .sb-fm-row[data-key="tags"] textarea',
      );
    };
    ghost.addEventListener("click", activate);
    // The editor would otherwise take Enter and Space as typing: the button
    // sits inside its scroller
    ghost.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      activate();
    });
    view.scrollDOM.appendChild(ghost);
    show();

    return {
      update(update) {
        const was = enabled;
        enabled = frontmatterGhostEnabled(update.state, client);
        if (!enabled) hovered = false;
        // A revealed heading marker moves line 1's text with the selection
        if (
          enabled !== was ||
          update.docChanged ||
          update.geometryChanged ||
          update.selectionSet
        ) {
          show();
        }
      },
      destroy() {
        view.scrollDOM.removeEventListener("pointermove", onMove);
        view.scrollDOM.removeEventListener("pointerleave", onLeave);
        ghost.remove();
      },
    };
  });
}
