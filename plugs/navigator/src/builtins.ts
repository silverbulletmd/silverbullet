/**
 * The built-in navigation pickers.
 */

import {
  config,
  editor,
  index,
  markdown,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { isMetaTag } from "@silverbulletmd/silverbullet/lib/tags";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import { compareCollated } from "@silverbulletmd/silverbullet/lib/collation";
import type { QueryCollationConfig } from "@silverbulletmd/silverbullet/type/config";
import type { Decoration, Row, ViewMeta } from "../ui/types.ts";
import { open } from "./navigator.ts";

type Obj = Record<string, any>;

type RowSpec = {
  primary?: (obj: Obj) => string;
  /** Tree mode: what a row reads as in place of its last path segment. */
  label?: (obj: Obj) => string | undefined;
  description?: (obj: Obj) => string | undefined;
  decorations?: (obj: Obj) => Decoration[] | undefined;
  cssClass?: (obj: Obj) => string | undefined;
  icon?: (obj: Obj) => string | undefined;
};

type Segment = {
  label: string;
  icon?: string;
  prefix?: string;
  placeholder?: string;
  default?: boolean;
  where?: (obj: Obj) => boolean;
};

type ActionSpec = {
  icon?: string;
  label: string;
  /** `%s` stands for the row's primary label, substituted in the
   * `navigator:action` handler below via a function replacer (never a string
   * one -- the primary could itself contain `$&`-style patterns). */
  confirm?: string;
  requireMode?: "rw";
  when?: (obj: Obj) => boolean;
  run: (obj: Obj) => Promise<any> | any;
};

type BuiltinView = {
  meta: Omit<ViewMeta, "segments" | "name"> & { segments?: never };
  segments?: Segment[];
  actions?: ActionSpec[];
  row: RowSpec;
  source: () => Promise<Obj[]>;
  /** @returns `false` to keep the panel open (see the Lua `onSelect` docs). */
  onSelect?: (obj: Obj, ctx: { from?: string }) => Promise<any>;
  onCreate?: (phrase: string) => Promise<any>;
  /** Keyed by `KeyboardEvent.key`; see `navigator.define`'s `keymap` field. */
  keymap?: Record<string, (obj: Obj) => Promise<any> | any>;
  onMove?: (obj: Obj, newName: string) => Promise<any>;
};

/** Everything a view leaves at its defaults, so each one only says what differs. */
function baseMeta(over: Partial<ViewMeta>): BuiltinView["meta"] {
  return {
    title: over.title ?? "",
    mode: "list",
    dock: "modal",
    hierarchy: { field: "name", separator: "/" },
    foldersFirst: true,
    expandAll: false,
    expansionScope: "view",
    followEditor: false,
    refreshOn: ["file:changed", "file:deleted", "mq:emptyQueue:indexQueue"],
    hasMove: false,
    hasCreate: false,
    refreshOnOpen: false,
    limit: 200,
    search: "client",
    hasRowIcon: true,
    pathCompletion: false,
    hashtagFilter: false,
    ...over,
  } as BuiltinView["meta"];
}

// --- the page picker -------------------------------------------------------

function isMetaPage(obj: Obj): boolean {
  if (obj.tag !== "page") return false;
  for (const tag of obj.tags ?? []) {
    if (tag === "template" || isMetaTag(tag)) return true;
  }
  return false;
}

function isHiddenPage(obj: Obj): boolean {
  return obj.pageDecoration?.hide === true;
}

async function isReadOnly(): Promise<boolean> {
  if ((await system.getMode()) === "ro") return true;
  return (await editor.getUiOption("forcedROMode")) === true;
}

/**
 * Extensions this client has a document editor for, as of the last source
 * run. A property of the client (which plugs are loaded), not of the object,
 * so no query reaches it -- and read again by the row decorators below, which
 * run per row and must not each cost a syscall.
 */
let viewableExtensions = new Set<string>();

/**
 * Pages and documents, newest first, from the index when there is one and
 * from the space's file listing when there isn't.
 *
 * The fallback is deliberately the same trade the client's own page-list
 * cache makes (`Client.updatePageListCache`): raw file metadata, no tags, no
 * page decorations, no aspiring pages -- but a picker that lists the space
 * rather than an empty one. `refreshOn` picks up the real thing as indexing
 * delivers it, and `refreshOnOpen` guarantees it by the next open.
 */
export async function spaceContents(): Promise<Obj[]> {
  if (await index.isAvailable()) {
    const [pages, documents] = await Promise.all([
      index.queryLuaObjects("page", {} as any),
      index.queryLuaObjects("document", {} as any),
    ]);
    return [...pages, ...documents] as Obj[];
  }
  const [pages, documents] = await Promise.all([
    space.listPages(),
    space.listDocuments(),
  ]);
  return [
    // The same heuristic the client's pre-index fallback uses: without the
    // index there are no tags to sort meta pages by, and everything shipped
    // under Library/ is one.
    ...pages.map((page) => ({
      ...page,
      tag: "page",
      tags: page.name.startsWith("Library/") ? ["meta"] : [],
    })),
    ...documents.map((document) => ({ ...document, tag: "document" })),
  ];
}

/** Linked-to pages that don't exist yet, one row per target rather than per link. */
async function aspiringRows(): Promise<Obj[]> {
  if (!(await index.isAvailable())) return [];
  const names = await index.queryLuaObjects<string>("aspiring-page", {
    select: { type: "Variable", name: "name", ctx: {} } as any,
    distinct: true,
  } as any);
  return names.map((name) => ({ name, tag: "page", isAspiring: true }));
}

function lastModifiedOf(obj: Obj): string {
  return obj.lastModified ?? "";
}

async function pagePickerSource(): Promise<Obj[]> {
  const [opened, path, extensions, mode, contents, aspiring] =
    await Promise.all([
      editor.getLastOpenedMap(),
      editor.getCurrentPath(),
      editor.getViewableExtensions(),
      system.getMode(),
      spaceContents(),
      aspiringRows(),
    ]);
  viewableExtensions = new Set(extensions);
  const readOnly =
    mode === "ro" || (await editor.getUiOption("forcedROMode")) === true;

  const recent: Obj[] = [];
  const rest: Obj[] = [];
  const current: Obj[] = [];
  const unopenable: Obj[] = [];
  for (const obj of contents) {
    const isDocument = obj.tag === "document";
    if (isDocument && !viewableExtensions.has(obj.extension)) {
      // Nothing on this client can render it. Still listed, so it can be
      // renamed or deleted -- but not in read-only mode, where there is
      // nothing left to do with it at all.
      if (!readOnly) unopenable.push(obj);
    } else if (path === (isDocument ? obj.name : `${obj.name}.md`)) {
      // The page you are looking at is the one you are least likely to want.
      current.push(obj);
    } else if (opened[obj.name] !== undefined) {
      recent.push(obj);
    } else {
      rest.push(obj);
    }
  }
  recent.sort((a, b) => opened[b.name] - opened[a.name]);
  rest.sort((a, b) => lastModifiedOf(b).localeCompare(lastModifiedOf(a)));
  return [...recent, ...rest, ...current, ...aspiring, ...unopenable];
}

function hashtagChips(obj: Obj): Decoration[] {
  const tags: unknown = obj.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => ({
      text: `#${tag}`,
      position: "right" as const,
      cssClass: "sb-hashtag",
    }));
}

function pickerDescription(obj: Obj): string | undefined {
  const parts: string[] = [];
  const aliases: string[] = [];
  if (obj.displayName) aliases.push(obj.displayName);
  if (Array.isArray(obj.aliases)) aliases.push(...obj.aliases);
  if (aliases.length > 0) parts.push(`(a.k.a. ${aliases.join(", ")})`);
  if (obj.description) parts.push(String(obj.description).slice(0, 200));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function spaceIcon(obj: Obj): string {
  if (obj.isAspiring) return "file-plus";
  if (obj.tag === "document") {
    return String(obj.contentType ?? "").startsWith("image/")
      ? "image"
      : "file";
  }
  return "file-text";
}

const pagePicker: BuiltinView = {
  meta: baseMeta({
    title: "Pages",
    label: "Open",
    hasCreate: true,
    // The create row makes a page, and says so before it says the name.
    createIcon: "file-text",
    refreshOnOpen: true,
    pathCompletion: true,
    hashtagFilter: true,
    prefixViews: { $: "std.anchors", "#": "std.tags" },
    // Ranked against the raw name, not the drawn one: a page decorated with
    // an emoji prefix shouldn't have to be found by typing the emoji.
    filterFields: {
      name: { weight: 1.0, segments: true },
      description: 0.5,
    },
  }),
  segments: [
    {
      label: "Pages",
      icon: "file-text",
      placeholder: "Page",
      default: true,
      where: (obj) =>
        obj.tag === "page" && !isMetaPage(obj) && !isHiddenPage(obj),
    },
    {
      label: "Meta",
      icon: "settings",
      placeholder: "Meta page",
      prefix: "^",
      where: (obj) => isMetaPage(obj) && !isHiddenPage(obj),
    },
    {
      label: "Docs",
      icon: "file",
      placeholder: "Document",
      where: (obj) => obj.tag === "document",
    },
    // The one segment that keeps hidden pages.
    { label: "All", icon: "layers", placeholder: "Page or document" },
  ],
  row: {
    primary: (obj) =>
      obj.pageDecoration?.prefix
        ? `${obj.pageDecoration.prefix}${obj.name}`
        : obj.name,
    description: pickerDescription,
    decorations: (obj) => {
      if (obj.isAspiring) {
        return [
          { text: "Create", position: "right", cssClass: "sb-nav-chip-hint" },
        ];
      }
      const chips = hashtagChips(obj);
      if (obj.tag === "document" && obj.extension) {
        chips.push({
          text: String(obj.extension).toUpperCase(),
          position: "right",
          // Greyed out when this client has no editor for it: the row is still
          // selectable, it just isn't an offer.
          cssClass: viewableExtensions.has(obj.extension)
            ? undefined
            : "sb-nav-chip-inactive",
        });
      }
      return chips.length > 0 ? chips : undefined;
    },
    cssClass: (obj) => {
      if (obj.isAspiring) return "sb-nav-aspiring";
      const classes = obj.pageDecoration?.cssClasses;
      if (!Array.isArray(classes)) return undefined;
      // This ends up in a class attribute.
      return classes.join(" ").replaceAll(/[^a-zA-Z0-9-_ ]/g, "");
    },
    icon: spaceIcon,
  },
  source: pagePickerSource,
  // `open`, not the default `navigate`: picking a page you were just on puts
  // you back where you left it. A create is a fresh page and has nothing to
  // restore.
  onSelect: (obj) => editor.open(obj.ref ?? obj.name),
  onCreate: (phrase) => editor.navigate(phrase),
};

// --- anchors ---------------------------------------------------------------

const MAX_ANCHOR_DESCRIPTION = 100;

const anchorPicker: BuiltinView = {
  meta: baseMeta({
    title: "Anchors",
    label: "Open",
    placeholder: "Anchor",
    // Rows are named bare (the `$` is the row's icon's job), so a phrase that
    // carries the sigil still finds them.
    stripPrefix: "$",
    // Named explicitly rather than left to the panel's defaults, so the page
    // an anchor lives on is matchable too -- "intro proj" finds `$intro` on
    // Projects/Alpha.
    filterFields: {
      primary: { weight: 1.0, segments: true },
      page: { weight: 0.6, segments: true },
      description: 0.4,
    },
  }),
  row: {
    primary: (obj) => String(obj.ref),
    description: (obj) => {
      const firstLine = String(obj.snippet ?? "")
        .split("\n")[0]
        .trim();
      if (!firstLine) {
        // Also the path a page-level (frontmatter `$ref`) anchor takes: it has
        // no host block to snippet.
        return `${obj.hostTag ?? "anchor"} on ${obj.page}`;
      }
      const truncated =
        firstLine.length > MAX_ANCHOR_DESCRIPTION
          ? `${firstLine.slice(0, MAX_ANCHOR_DESCRIPTION)}…`
          : firstLine;
      return `${truncated} — ${obj.page}`;
    },
    decorations: (obj) =>
      obj.hostTag ? [{ text: obj.hostTag, position: "right" }] : undefined,
    icon: () => "anchor",
  },
  source: async () => {
    if (!(await index.isAvailable())) return [];
    const anchors = await index.queryLuaObjects<Obj>("anchor", {} as any);
    return [...anchors].sort((a, b) =>
      String(b.pageLastModified ?? "").localeCompare(
        String(a.pageLastModified ?? ""),
      ),
    );
  },
  onSelect: (obj) =>
    // Page-qualified deliberately: duplicate anchor names each get their own
    // row, and this opens the one that was picked instead of tripping the
    // ambiguous-anchor error.
    editor.navigate({
      path: `${obj.page}.md`,
      details: { type: "anchor", name: obj.ref },
    } as any),
};

// --- tags ------------------------------------------------------------------

const tagPicker: BuiltinView = {
  meta: baseMeta({
    title: "Tags",
    label: "Open",
    placeholder: "Tag",
    // As with anchors: the `#` is the icon's job, not the label's.
    stripPrefix: "#",
    filterFields: { primary: { weight: 1.0, segments: true } },
  }),
  row: {
    primary: (obj) => String(obj.name),
    decorations: (obj) => [{ text: String(obj.count), position: "right" }],
    icon: () => "hash",
  },
  source: async () => {
    if (!(await index.isAvailable())) return [];
    // The index holds one record per tagged object, which is what makes the
    // count free.
    const counts = new Map<string, number>();
    for (const tag of await index.queryLuaObjects<Obj>("tag", {} as any)) {
      counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  },
  onSelect: async (obj, ctx) => {
    if (ctx.from) {
      // Reached by typing `#` into a picker: hand the slot back with the tag
      // applied, which is what a leading `#` used to do in place. `false`
      // keeps this panel from closing the view it just opened into itself.
      await open(ctx.from, { phrase: `#${obj.name} ` });
      return false;
    }
    const tagPage = await config.get<string | null>(
      ["tags", obj.name, "tagPage"],
      null,
    );
    await editor.navigate(tagPage ?? `tag:${obj.name}`);
  },
};

// --- the command palette ---------------------------------------------------

const commandPalette: BuiltinView = {
  meta: baseMeta({
    title: "Commands",
    label: "Run",
    placeholder: "Command",
    filterFields: { primary: { weight: 1.0, segments: true } },
    // Which commands apply (the cursor's context, the client's mode) and
    // which you ran last are both only true at the moment you ask.
    refreshOnOpen: true,
    // Not the file events every other view wants: the command list changes
    // when plugs (re)load, and nothing else.
    refreshOn: ["plugs:loaded"],
  }),
  row: {
    decorations: (obj) =>
      obj.hint
        ? [
            {
              text: obj.hint,
              position: "right",
              cssClass: "sb-nav-chip-hint sb-nav-chip-key",
            },
          ]
        : undefined,
    icon: () => "terminal",
  },
  source: async () => {
    const commands = await system.listPaletteCommands();
    return [...commands].sort((a, b) => {
      // Anything you have run on this client outranks anything merely
      // declared important.
      if (a.lastRun !== undefined && b.lastRun !== undefined) {
        return b.lastRun - a.lastRun;
      }
      if (a.lastRun !== undefined || b.lastRun !== undefined) {
        return a.lastRun !== undefined ? -1 : 1;
      }
      return b.priority - a.priority || a.name.localeCompare(b.name);
    });
  },
  onSelect: async (obj) => {
    // The palette has to be out of the way *before* the command runs: a
    // command that opens another navigator view would otherwise have its
    // panel closed again by this one's own dismissal.
    await editor.hidePanel("modal");
    // Records the run (which is what orders the palette) and then runs it. A
    // command returning false is one that took the focus deliberately.
    if ((await system.runPaletteCommand(obj.name)) !== false) {
      await editor.focus();
    }
    return false;
  },
};

// --- the outline (table of contents) ---------------------------------------

type Header = { name: string; pos: number; level: number };

/** A page's ATX headings, in document order. Shared with the top-of-page TOC
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
async function outlineRows(): Promise<Obj[]> {
  const path = await editor.getCurrentPath();
  if (!path.endsWith(".md")) return [];
  const [pageName, text] = await Promise.all([
    editor.getCurrentPage(),
    editor.getText(),
  ]);
  const stack: { level: number; path: string }[] = [];
  const taken = new Set<string>();
  const rows: Obj[] = [];
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

async function jumpToHeader(obj: Obj): Promise<void> {
  await editor.navigate({
    path: `${obj.page}.md`,
    details: { type: "position", pos: obj.pos },
  } as any);
}

/** Shared by `std.toc` (docked) and `std.tocModal` (picker) -- an outline is
 * the same thing in either, so the overlay is the whole of the difference. */
function outlineView(over: Partial<BuiltinView["meta"]>): BuiltinView {
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

const tocView = outlineView({ dock: "rhs" });
tocView.meta.refreshOn = [
  "editor:pageModified",
  "editor:pageLoaded",
  "editor:documentLoaded",
];
// Peek: jump to the header without leaving the panel, so the next arrow
// keeps browsing. Not on `std.tocModal`: there Enter already closes the
// panel, so there is nothing for Space to do differently.
tocView.keymap = { " ": jumpToHeader };

const tocModalView = outlineView({ label: "Outline", dock: "modal" });

// --- the space tree ----------------------------------------------------

/** Folder rows (and page/folder duals) arrive as `{ name, isFolder = true }`,
 * synthesized client-side from the tree's own hierarchy -- which is why this
 * leads with `isFolder` rather than with the tag. */
function treeIcon(obj: Obj): string {
  if (obj.isFolder) return "folder";
  if (obj.isAspiring) return "file-plus";
  // `perm` is a read-only (in the schema sense) system field -- reaches this
  // object for free, since the source selects the whole row -- so a page or
  // document the space can't write to is flagged the same way regardless of
  // kind. `lock` over `eye`: "eye" reads as a visibility/hide toggle (see
  // `pageDecoration.hide`), not a write-permission one.
  if (obj.perm === "ro") return "lock";
  if (obj.tag === "document") {
    return String(obj.contentType ?? "").startsWith("image/")
      ? "image"
      : "file";
  }
  return "file-text";
}

const spaceTreeSegments: Segment[] = [
  {
    label: "All",
    icon: "layers",
    default: true,
    placeholder: "Page or document",
  },
  {
    label: "Pages",
    icon: "file-text",
    placeholder: "Page",
    where: (obj) => obj.tag === "page" && !isMetaPage(obj),
  },
  {
    label: "Meta",
    icon: "settings",
    placeholder: "Meta page",
    where: isMetaPage,
  },
  {
    label: "Docs",
    icon: "file",
    placeholder: "Document",
    where: (obj) => obj.tag === "document",
  },
];

/** `spaceContents()` already degrades pre-index the same way the space
 * picker needs to; the tree wants the identical set, just alphabetical
 * rather than recency-ordered, honouring the same `queryCollation` config
 * the indexed `order by _.name` query path does. */
async function spaceTreeSource(): Promise<Obj[]> {
  const contents = await spaceContents();
  const collation = await config.get<QueryCollationConfig>(
    "queryCollation",
    {},
  );
  const collator = Intl.Collator(collation?.locale, collation?.options);
  return [...contents].sort((a, b) =>
    compareCollated(String(a.name), String(b.name), collation, collator)
  );
}

async function moveByRename(obj: Obj, newName: string): Promise<void> {
  if (obj.isFolder) {
    // Covers documents as well as pages under the prefix.
    await system.invokeFunction("index.renamePrefixCommand", {
      oldPrefix: `${obj.name}/`,
      newPrefix: `${newName}/`,
      disableConfirmation: true,
    });
  }
  // A page that also has children is both: renamePrefixCommand only touches
  // files under "name/", so the page itself still needs its own rename.
  if (!obj.isFolder || obj.ref) {
    if (obj.tag === "document") {
      // A document's name carries its extension and is the file name itself,
      // so the page rename (which appends ".md") would rename the wrong file.
      await system.invokeFunction("index.renameDocumentCommand", {
        oldDocument: obj.name,
        document: newName,
      });
    } else {
      await system.invokeFunction("index.renamePageCommand", {
        oldPage: obj.name,
        page: newName,
      });
    }
  }
}

/** Renaming means something different for each of the three kinds of row a
 * space tree has, and only the folder case needs a prompt of its own (the
 * other two are the same commands the editor's own rename commands run). */
async function renameTreeRow(obj: Obj): Promise<void> {
  if (obj.isFolder) {
    const newName = await editor.prompt(`Rename ${obj.name} to:`, obj.name);
    if (newName == null) return;
    const trimmed = newName.trim();
    if (trimmed === "" || trimmed === obj.name) return;
    await moveByRename(obj, trimmed);
  } else if (obj.tag === "document") {
    await system.invokeFunction("index.renameDocumentCommand", {
      oldDocument: obj.name,
    });
  } else {
    await system.invokeFunction("index.renamePageCommand", {
      oldPage: obj.name,
    });
  }
}

async function deleteTreeRow(obj: Obj): Promise<void> {
  if (obj.tag === "document") {
    await space.deleteDocument(obj.name);
  } else {
    await space.deletePage(obj.name);
  }
}

async function newPageUnder(obj: Obj): Promise<void> {
  const prefill = `${obj.name}/`;
  const name = await editor.prompt("New page name:", prefill);
  if (name == null) return;
  const trimmed = name.trim();
  // Confirming the prefill unedited means "never mind": navigating to a bare
  // "Folder/" would try to open a page with an empty last segment.
  if (trimmed === "" || trimmed === prefill) return;
  // SilverBullet creates the page on the first edit; navigating there is the
  // whole of "new page".
  await editor.navigate(trimmed);
}

// A pure folder has no object behind it, so it has nothing to delete (and
// deleting a whole subtree is not a job for a hover button). A page that also
// heads a folder keeps its own delete: it has a page to remove.
function isDeletable(obj: Obj): boolean {
  return !obj.isFolder || obj.ref != null;
}

const spaceTreeView: BuiltinView = {
  meta: baseMeta({
    title: "Space",
    // Matches the modal pickers' chrome: a short verb where the title goes,
    // with the segment naming what it picks in the input's placeholder.
    label: "Open",
    dock: "lhs",
    mode: "tree",
    followEditor: true,
    hasCreate: true,
    // Matches "Navigator: Tree"'s own key/mac (navigator.plug.yaml) -- see
    // `ViewMeta.toggleKey`.
    toggleKey: "o",
    // Folders sort in with pages rather than above them, so a name is where
    // the alphabet says it is whether or not it happens to have children.
    foldersFirst: false,
  }),
  row: { icon: treeIcon },
  segments: spaceTreeSegments,
  actions: [
    {
      icon: "plus",
      label: "New page here",
      requireMode: "rw",
      when: (obj) => obj.isFolder === true,
      run: newPageUnder,
    },
    { icon: "edit-3", label: "Rename", requireMode: "rw", run: renameTreeRow },
    {
      icon: "trash-2",
      label: "Delete",
      confirm: "Delete %s?",
      requireMode: "rw",
      when: isDeletable,
      run: deleteTreeRow,
    },
  ],
  keymap: {
    // Peek: open the row without leaving the panel, so the next arrow keeps
    // browsing. `editor.navigate` focuses the editor; the panel takes focus
    // back on its own afterwards.
    " ": (obj) => editor.navigate(obj.ref ?? obj.name),
  },
  onMove: moveByRename,
  source: spaceTreeSource,
  onCreate: (name) => editor.navigate(name),
};

const views: Record<string, BuiltinView> = {
  "std.pages": pagePicker,
  "std.anchors": anchorPicker,
  "std.tags": tagPicker,
  "std.commands": commandPalette,
  "std.toc": tocView,
  "std.tocModal": tocModalView,
  "std.spaceTree": spaceTreeView,
};

// Mirrors Lua's own `reservedKeys` (`navigator.define`, Navigator.md): a
// built-in claiming one of these would silently shadow panel navigation
// (`keyboard.ts`'s `tryKeymap` runs ahead of it), with no error anywhere to
// say so. Lua rejects this at definition time; this is the TS registry's
// equivalent, at module load instead, since there is no per-call `define`.
const RESERVED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Escape",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Tab",
]);

export function validateKeymaps(
  registry: Record<string, Pick<BuiltinView, "keymap">>,
): void {
  for (const [name, view] of Object.entries(registry)) {
    for (const key of Object.keys(view.keymap ?? {})) {
      if (RESERVED_KEYS.has(key)) {
        throw new Error(
          `navigator builtin "${name}": keymap key "${key}" is reserved by built-in navigation`,
        );
      }
    }
  }
}

validateKeymaps(views);

export function builtinMeta(name: string): ViewMeta | undefined {
  const view = views[name];
  if (!view) return undefined;
  return {
    ...view.meta,
    name,
    hasMove: !!view.onMove,
    keys: view.keymap ? Object.keys(view.keymap) : undefined,
    actions: view.actions?.map((action) => ({
      icon: action.icon,
      label: action.label,
      confirm: action.confirm,
      hasWhen: action.when !== undefined,
      requireMode: action.requireMode,
    })),
    segments: view.segments?.map((segment) => ({
      label: segment.label,
      icon: segment.icon,
      hasWhere: segment.where !== undefined,
      default: segment.default === true,
      prefix: segment.prefix,
      placeholder: segment.placeholder,
    })),
  } as ViewMeta;
}

async function builtinRows(name: string): Promise<Row[] | { error: string }> {
  const view = views[name];
  if (!view) return [];
  try {
    const objs = await view.source();
    return objs.map((obj) => ({
      obj,
      primary: view.row.primary?.(obj) ?? obj.name ?? obj.ref,
      label: view.row.label?.(obj),
      description: view.row.description?.(obj),
      decorations: view.row.decorations?.(obj),
      cssClass: view.row.cssClass?.(obj),
    }));
  } catch (e: any) {
    // The panel renders this rather than emptying itself, same as the Lua
    // bridge does with a throwing source.
    return { error: e?.message ?? String(e) };
  }
}

/**
 * One pass over the whole batch, exactly as the Lua bridge does it: every
 * segment predicate and every row icon, for every object the panel may draw.
 */
function builtinRowState(name: string, objs: Obj[]) {
  const view = views[name];
  if (!view) return [];
  // A source-mode view subsets in its own source, off the segment label it is
  // handed; its `where` predicates are never consulted. No built-in is
  // source-mode today -- this is here so the two registries answer the same
  // way if one ever is.
  const wantsSegments = view.segments && view.meta.search !== "source";
  const wantsActions = !!view.actions;
  return objs.map((obj) => {
    const entry: { segments?: boolean[]; actions?: boolean[]; icon?: string } =
      {};
    if (wantsSegments) {
      entry.segments = view.segments!.map((segment) => {
        if (!segment.where) return true;
        // Fail-closed: a throwing predicate drops the row from its segment
        // rather than taking down the pass.
        try {
          return segment.where(obj) === true;
        } catch {
          return false;
        }
      });
    }
    if (wantsActions) {
      entry.actions = view.actions!.map((action) => {
        if (!action.when) return true;
        // Same fail-closed rule as segments: a throwing predicate hides its
        // action rather than taking down the whole pass.
        try {
          return action.when(obj) === true;
        } catch {
          return false;
        }
      });
    }
    // Guarded per row, like the Lua bridge: one throwing icon costs that row
    // its icon, not the whole pass -- which the panel would read as every
    // segment being empty.
    try {
      const icon = view.row.icon?.(obj);
      if (icon) entry.icon = icon;
    } catch {
      // no icon for this row
    }
    return entry;
  });
}

/**
 * What the Lua bridge's `runHandler` does, for the TS registry's handlers: a
 * throwing `onSelect`/`onCreate` becomes a notification rather than a
 * rejection nobody catches. The panel dispatches these fire-and-forget, so an
 * escaping error would leave the user with a panel that silently did nothing
 * (or, for the modal, one that vanished without acting).
 */
async function runHandler<T>(
  what: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e: any) {
    await editor.flashNotification(
      `navigator ${what}: ${e?.message ?? e}`,
      "error",
    );
    return undefined;
  }
}

/**
 * The whole built-in registry behind one plug function, dispatched on the
 * bridge event the panel would otherwise have sent to Lua. One function
 * rather than one per event because the panel reaches it through
 * `system.invokeFunction`, and a name per event would be four more manifest
 * entries saying the same thing.
 */
export async function builtin(data: { event: string; data: any }) {
  const { event } = data;
  const payload = data.data ?? {};
  const name: string = payload.name;
  switch (event) {
    case "navigator:meta":
      return builtinMeta(name);
    case "navigator:rows":
      return await builtinRows(name);
    case "navigator:rowState":
      return builtinRowState(name, payload.objs ?? []);
    case "navigator:select": {
      const view = views[name];
      if (!view) return undefined;
      return await runHandler("onSelect", () =>
        view.onSelect
          ? view.onSelect(payload.obj, { from: payload.from })
          : editor.navigate(payload.obj.ref ?? payload.obj.name),
      );
    }
    case "navigator:create": {
      const view = views[name];
      if (!view?.onCreate) return undefined;
      return await runHandler("onCreate", () => view.onCreate!(payload.phrase));
    }
    case "navigator:key": {
      const fn = views[name]?.keymap?.[payload.key];
      if (!fn) return undefined;
      return await runHandler("keymap", () => fn(payload.obj));
    }
    case "navigator:action": {
      // `index` is 1-based from the engine (`engine.ts`'s `action()`), same
      // as Lua's own `actions` table.
      const action = views[name]?.actions?.[payload.index - 1];
      if (!action) return undefined;
      if (action.requireMode === "rw" && (await isReadOnly())) {
        await editor.flashNotification(
          `navigator: ${action.label} is unavailable in read-only mode`,
          "error",
        );
        return undefined;
      }
      return await runHandler("action", async () => {
        if (action.confirm) {
          // A function replacement, so a `%` in the row's own name (or `$&`,
          // `$1`, etc.) isn't read as a capture/replacement pattern by
          // `String.replace`.
          const message = action.confirm.replace(
            /%s/g,
            () => payload.primary ?? "",
          );
          if (!(await editor.confirm(message))) return undefined;
        }
        return await action.run(payload.obj);
      });
    }
    case "navigator:move": {
      const view = views[name];
      if (!view?.onMove) return undefined;
      return await runHandler("onMove", () =>
        view.onMove!(payload.obj, payload.newName),
      );
    }
    default:
      return undefined;
  }
}
