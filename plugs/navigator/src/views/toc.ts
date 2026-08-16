import { editor, markdown } from "@silverbulletmd/silverbullet/syscalls";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import { baseMeta, type BuiltinView } from "./types.ts";

type Header = { name: string; pos: number; level: number };

/** A header, nested by its path in the outline's own tree -- not an indexed
 * object (no `ref`/`tag`), and this view defines no segments/actions/row
 * icon, so the synthetic folder nodes a tree view also carries internally
 * (`builtins.ts`'s `builtinRowState`) never actually reach this view's own
 * code -- nothing here needs to tolerate one. */
type HeaderRow = {
  name: string;
  header: string;
  page: string;
  pos: number;
  level: number;
};

/**
 * A page's ATX headings, in document order. Shared with the top-of-page TOC
 * widget's own header walk (`widgets.tocHeaders`, Widgets.md) only in
 * spirit -- that one runs in Lua off the same parser, this one doesn't call
 * into it, so the two can drift in wording without one breaking the other. */
export async function pageHeaders(text: string): Promise<Header[]> {
  const tree = await markdown.parseMarkdown(text);
  const headers: Header[] = [];
  for (const child of tree.children ?? []) {
    const match = child.type?.match(/^ATXHeading(\d+)$/);
    if (!match) continue;
    // The heading mark ("## ") is the node's first child; everything after
    // it is the text.
    const label = (child.children ?? [])
      .slice(1)
      .map((node: ParseTree) => renderToText(node).trim())
      .join("")
      .replace(/\[\[(.*?)\]\]/g, "$1");
    if (label !== "") {
      headers.push({
        name: label,
        pos: child.from ?? 0,
        level: Number(match[1]),
      });
    }
  }
  return headers;
}

// A literal "/" would be read as a path separator by the tree's hierarchy;
// headers containing one are shown with this look-alike instead.
const PATH_SLASH = "∕";

/**
 * The current page's headers as rows nested by their ancestor chain: the
 * nearest preceding shallower header is the parent, so an H1 -> H3 jump
 * nests without inventing an empty H2 between them.
 */
async function outlineRows(): Promise<HeaderRow[]> {
  const path = await editor.getCurrentPath();
  if (!path.endsWith(".md")) return [];
  const [pageName, text] = await Promise.all([
    editor.getCurrentPage(),
    editor.getText(),
  ]);
  const stack: { level: number; path: string }[] = [];
  const taken = new Set<string>();
  const rows: HeaderRow[] = [];
  for (const header of await pageHeaders(text)) {
    while (stack.length > 0 && stack[stack.length - 1].level >= header.level) {
      stack.pop();
    }
    let nodePath = header.name.replaceAll("/", PATH_SLASH);
    if (stack.length > 0) {
      nodePath = `${stack[stack.length - 1].path}/${nodePath}`;
    }
    while (taken.has(nodePath)) nodePath = `${nodePath} @${header.pos}`;
    taken.add(nodePath);
    stack.push({ level: header.level, path: nodePath });
    rows.push({
      name: nodePath,
      header: header.name,
      page: pageName,
      pos: header.pos,
      level: header.level,
    });
  }
  return rows;
}

async function jumpToHeader(obj: HeaderRow): Promise<void> {
  await editor.navigate({
    path: `${obj.page}.md`,
    details: { type: "position", pos: obj.pos },
  } as any);
}

/** Shared by `std.toc` (docked) and `std.tocModal` (picker) -- an outline is
 * the same thing in either, so the overlay is the whole of the difference. */
function outlineView(
  over: Partial<BuiltinView["meta"]>,
): BuiltinView<HeaderRow> {
  return {
    meta: baseMeta({
      title: "Outline",
      placeholder: "Header",
      mode: "tree",
      expandAll: true,
      expansionScope: "page",
      foldersFirst: false,
      // No row icon: unlike the space tree, an outline is one kind of thing.
      hasRowIcon: false,
      refreshOn: ["editor:pageModified"],
      refreshOnOpen: true,
      ...over,
    }),
    row: {
      primary: (obj) => String(obj.header),
      label: (obj) => String(obj.header),
      cssClass: () => "sb-nav-noband",
    },
    source: outlineRows,
    onSelect: (obj) => jumpToHeader(obj),
  };
}

export const tocView = outlineView({ dock: "rhs" });
tocView.meta.refreshOn = [
  "editor:pageModified",
  "editor:pageLoaded",
  "editor:documentLoaded",
];
// Peek: jump to the header without leaving the panel, so the next arrow
// keeps browsing. Not on `std.tocModal`: there Enter already closes the
// panel, so there is nothing for Space to do differently.
tocView.keymap = { " ": jumpToHeader };

export const tocModalView = outlineView({ label: "Outline", dock: "modal" });
