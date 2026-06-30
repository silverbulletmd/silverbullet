import type { Client } from "../client.ts";
import { expressionToPortableMarkdown } from "../space_lua/render_widget.ts";
import { escapeBakedBody, findBakedSections } from "./regions.ts";

interface BodyEdit {
  from: number;
  to: number;
  insert: string;
}

/**
 * Compute the body replacements needed to (re-)bake every baked section in
 * `text`: re-evaluate each section's EXPR and produce a body edit for it.
 * Edits reference offsets in `text`, are in document order, and are
 * non-overlapping. Sections whose expression can't be baked (errors, html-only
 * widgets) are reported in `skipped` and left untouched. Shared by the editor
 * command and the pure text transform below.
 */
async function computeBakeEdits(
  client: Client,
  text: string,
  currentPageMeta?: { name: string } | undefined,
): Promise<{ edits: BodyEdit[]; skipped: string[] }> {
  const edits: BodyEdit[] = [];
  const skipped: string[] = [];
  for (const section of findBakedSections(text)) {
    const result = await expressionToPortableMarkdown(
      client,
      section.expr,
      currentPageMeta,
    );
    if (!result.ok) {
      skipped.push(`"${section.expr}" (${result.reason})`);
      continue;
    }
    const body = escapeBakedBody(result.markdown).trim();
    edits.push({ from: section.bodyFrom, to: section.bodyTo, insert: `\n${body}\n` });
  }
  return { edits, skipped };
}

/**
 * Re-bake every baked section in a markdown `text` and return the updated text.
 * Pure transform (no editor) for programmatic use — see the
 * `markdown.bakeSections` syscall. `pageName` sets the `currentPage` context for
 * the evaluated expressions (defaults to the client's current page).
 */
export async function bakeSectionsInText(
  client: Client,
  text: string,
  pageName?: string,
): Promise<string> {
  const { edits } = await computeBakeEdits(
    client,
    text,
    pageName ? { name: pageName } : undefined,
  );
  // Apply edits back-to-front so earlier offsets stay valid.
  let out = text;
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  }
  return out;
}

/**
 * Update every baked section (`<!--#lua EXPR -->` … `<!--/lua-->`) on the
 * current page in place: re-evaluate each EXPR and replace its body with clean
 * GFM markdown. Static + manual — runs only when the command is invoked.
 */
export async function updateBakedSections(client: Client): Promise<void> {
  const view = client.editorView;
  const text = view.state.doc.toString();
  if (findBakedSections(text).length === 0) {
    client.ui.flashNotification("No baked sections (<!--#lua … -->) to update");
    return;
  }
  // Edits reference the ORIGINAL offsets; sections are ordered and
  // non-overlapping, so a single ChangeSet applies them correctly.
  const { edits, skipped } = await computeBakeEdits(
    client,
    text,
    client.currentPageMeta(),
  );

  if (edits.length > 0) {
    view.dispatch({ changes: edits });
  }
  if (skipped.length > 0) {
    client.ui.flashNotification(
      `Updated ${edits.length} baked section(s), skipped ${skipped.length}: ${
        skipped.join(", ")
      }`,
      "error",
    );
  } else {
    client.ui.flashNotification(`Updated ${edits.length} baked section(s)`);
  }
}

/**
 * Unbake the single baked section the cursor is in: replace it with `${EXPR}`,
 * restoring the live directive for editing. Operates only on the section under
 * the cursor (not the whole page).
 */
export function unbakeSectionAtCursor(client: Client): void {
  const view = client.editorView;
  const text = view.state.doc.toString();
  const cursor = view.state.selection.main.head;
  // Sections are non-overlapping; the cursor is "in" a section when it sits
  // anywhere within the full marker-to-marker span (inclusive).
  const section = findBakedSections(text).find(
    (s) => cursor >= s.start && cursor <= s.end,
  );
  if (!section) {
    client.ui.flashNotification(
      "Place the cursor inside a baked section (<!--#lua … -->) to unbake",
    );
    return;
  }
  const insert = `\${${section.expr}}`;
  view.dispatch({
    changes: { from: section.start, to: section.end, insert },
    // Put the cursor back inside the restored directive.
    selection: { anchor: section.start + insert.length },
  });
  client.focus();
}
