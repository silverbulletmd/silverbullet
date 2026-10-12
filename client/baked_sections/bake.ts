import type { Client } from "../client.ts";
import { expressionToPortableMarkdown } from "../markdown_renderer/compose_client.ts";
import {
  type BakedSection,
  bakedBody,
  bakedSectionAt,
  findBakedSections,
  unbakeChange,
} from "./regions.ts";

type BodyEdit = {
  from: number;
  to: number;
  insert: string;
};

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
    const edit = await bakeEdit(client, section, currentPageMeta);
    if (typeof edit === "string") skipped.push(edit);
    else edits.push(edit);
  }
  return { edits, skipped };
}

/** The body edit re-baking `section`, or why it can't be baked. */
async function bakeEdit(
  client: Client,
  section: BakedSection,
  currentPageMeta?: { name: string },
): Promise<BodyEdit | string> {
  const result = await expressionToPortableMarkdown(
    client,
    section.expr,
    currentPageMeta,
  );
  if (!result.ok) return `"${section.expr}" (${result.reason})`;
  return {
    from: section.bodyFrom,
    to: section.bodyTo,
    insert: bakedBody(result.markdown),
  };
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
      `Updated ${edits.length} baked section(s), skipped ${skipped.length}: ${skipped.join(
        ", ",
      )}`,
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
  if (!unbakeSection(client, client.editorView.state.selection.main.head)) {
    client.ui.flashNotification(
      "Place the cursor inside a baked section (<!--#lua … -->) to unbake",
    );
  }
}

/** The section at `pos` in the open page, as it is now. */
function sectionAt(client: Client, pos: number) {
  return bakedSectionAt(client.editorView.state.doc.toString(), pos);
}

/** Unbakes the section at `pos`; false when there is none. */
export function unbakeSection(client: Client, pos: number): boolean {
  const section = sectionAt(client, pos);
  if (!section) return false;
  client.editorView.dispatch(unbakeChange(section));
  client.focus();
  return true;
}

/** Re-bakes only the section at `pos`. */
export async function updateBakedSection(
  client: Client,
  pos: number,
): Promise<void> {
  const section = sectionAt(client, pos);
  if (!section) return;
  const edit = await bakeEdit(client, section, client.currentPageMeta());
  if (typeof edit === "string") {
    client.ui.flashNotification(`Couldn't update ${edit}`, "error");
    return;
  }
  // The page may have changed while evaluating: only apply to the same body
  const now = sectionAt(client, pos);
  if (now?.bodyFrom !== section.bodyFrom || now.bodyTo !== section.bodyTo) {
    return;
  }
  client.editorView.dispatch({ changes: edit });
}

/** Puts the cursor in the section's opening marker, revealing it. */
export function editBakedExpression(client: Client, pos: number): void {
  const section = sectionAt(client, pos);
  if (!section) return;
  client.editorView.dispatch({
    selection: { anchor: section.start + "<!--#lua ".length },
    scrollIntoView: true,
  });
  client.focus();
}

/** Copies the section's baked Markdown body. */
export async function copyBakedSection(
  client: Client,
  pos: number,
): Promise<void> {
  const section = sectionAt(client, pos);
  if (!section) return;
  const text = client.editorView.state.doc.sliceString(
    section.bodyFrom,
    section.bodyTo,
  );
  await client.clientSystem.localSyscall("editor.copyToClipboard", [
    text.trim(),
  ]);
  client.ui.flashNotification("Copied as Markdown");
}
