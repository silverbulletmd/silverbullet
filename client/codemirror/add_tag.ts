// "Add tag" on a page without frontmatter: line 1's handle menu offers it
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Client } from "../client.ts";
import { findFrontmatterBlock } from "./syntax/frontmatter_block.ts";
import {
  focusWhenShown,
  hookLookup,
  previewsEnabled,
} from "./syntax/object_preview.ts";

/** What "Add tag" inserts: frontmatter with an empty `tags` */
export const NEW_FRONTMATTER = "---\ntags:\n---\n";

/**
 * Whether an editable page without frontmatter offers "Add tag" in line 1's
 * handle menu. Only the default form edits frontmatter, so it goes with
 * liveEdit.frontmatter.
 */
export function addTagAvailable(client: Client, state: EditorState): boolean {
  return (
    !findFrontmatterBlock(state) &&
    previewsEnabled(client, state) &&
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

/** Inserts `tags:` frontmatter and focuses the tags field once the form shows */
export function addTag(view: EditorView, client: Client): void {
  // The page may have frontmatter by now
  if (!addTagAvailable(client, view.state)) return;
  insertFrontmatter(view);
  focusWhenShown(
    view,
    0,
    '.sb-fm-row[data-key="tags"] input, .sb-fm-row[data-key="tags"] textarea',
  );
}
