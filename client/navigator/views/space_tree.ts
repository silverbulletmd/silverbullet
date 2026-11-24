import { leaveBeforeDeleting } from "@silverbulletmd/silverbullet/lib/leave_deleted";
import {
  splitPath,
  TREE_ORDER_PAGE,
  type TreeAttributes,
  TreeIndex,
} from "@silverbulletmd/silverbullet/lib/tree_order";
import { editor, space, system } from "@silverbulletmd/silverbullet/syscalls";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { moveByRename } from "../move_by_rename.ts";
import { expandRefreshTriggers } from "../refresh_triggers.ts";
import {
  HIDDEN_ROW_CLASS,
  inLibrary,
  isHiddenPage,
  spaceContents,
} from "./pages.ts";
import {
  cachedTreeAttributes,
  cachedTreeOrder,
  loadTreeOrder,
  reorderSibling,
  saveFolderOrder,
  setTreeAttribute,
  sortByTreeOrder,
  treeCollate,
} from "./space_tree_order.ts";
import { type BuiltinView, baseMeta, type Segment } from "./types.ts";

type TreeObj = Partial<ObjectValue<Record<string, any>>> & {
  name: string;
  isFolder?: boolean;
  /** Set by the source on rows hidden from navigation (see `isTreeHidden`),
   * which only All shows. */
  isTreeHidden?: boolean;
};

function treeIcon(obj: TreeObj): string {
  const decorated = obj.pageDecoration?.icon;
  if (typeof decorated === "string" && decorated !== "") return decorated;
  const structured = cachedTreeAttributes().get(obj.name)?.icon;
  if (structured) return structured;
  // Only a pure folder gets the folder icon. A dual has a page behind it and
  // reads as that page, so it falls through to the icons below like any other.
  if (obj.isFolder && obj.ref == null) return "folder";
  if (obj.isAspiring) return "file-plus";
  if (obj.perm === "ro") return "lock";
  if (obj.tag === "document") {
    return String(obj.contentType ?? "").startsWith("image/")
      ? "image"
      : "file";
  }
  return "file-text";
}

/** Content and Library split the space by location; All is both, plus
 * the rows hidden from navigation. A folder synthesized from its children's
 * names carries no flag of its own, so it shows wherever any child does. */
export const spaceTreeSegments: Segment<TreeObj>[] = [
  {
    label: "Content",
    icon: "file-text",
    default: true,
    placeholder: "Page or document",
    where: (obj) => !inLibrary(obj) && !obj.isTreeHidden,
  },
  {
    label: "Library",
    icon: "wrench",
    placeholder: "Library page or document",
    where: (obj) => inLibrary(obj) && !obj.isTreeHidden,
  },
  { label: "All", icon: "layers", placeholder: "Page or document" },
];

/** A page hidden from navigation, `tree.hide`, or an `[hide: true]` on the
 * row or one of its folders in the order page. */
function isTreeHidden(obj: TreeObj, attributes: TreeAttributes): boolean {
  return (
    isHiddenPage(obj) ||
    obj.pageDecoration?.tree?.hide === true ||
    hiddenByStructure(obj.name, attributes)
  );
}

/** Whether `name` or one of its ancestor folders is marked `[hide: true]` in
 * the order page: hiding a folder there hides everything under it. */
function hiddenByStructure(name: string, attributes: TreeAttributes): boolean {
  for (const [path, attrs] of attributes) {
    if (attrs.hide !== "true") continue;
    if (name === path || name.startsWith(`${path}/`)) return true;
  }
  return false;
}

/** Whether `segment` shows `obj`; fail-closed, like the panel's own masks. */
function admits(segment: Segment<TreeObj>, obj: TreeObj): boolean {
  try {
    return segment.where?.(obj) ?? true;
  } catch {
    return false;
  }
}

// Rows from the last source run, in tree order, and the sibling index of
// each segment's share of them, built on first use: Move up/down read
// siblings from these (their `when` has to be synchronous).
let lastRows: TreeObj[] = [];
let siblingIndexes = new Map<string, TreeIndex>();

/** Siblings as the segment labelled `label` shows them (all rows for none). */
function siblingIndex(label: string | undefined): TreeIndex {
  const segment = spaceTreeSegments.find((s) => s.label === label);
  const key = segment?.label ?? "";
  let index = siblingIndexes.get(key);
  if (!index) {
    const rows = segment
      ? lastRows.filter((obj) => admits(segment, obj))
      : lastRows;
    index = new TreeIndex(rows.map((obj) => obj.name));
    siblingIndexes.set(key, index);
  }
  return index;
}

/** The first segment showing `obj`. Action masks are worked out once for all
 * segments, so Move up/down judge a row where it lives (Content, Library, or All for a hidden row);
 * in a narrower segment a move may find nothing to pass, and does nothing. */
function homeSegment(obj: TreeObj): string | undefined {
  return spaceTreeSegments.find((s) => admits(s, obj))?.label;
}

// Whether the server keeps folders of their own (empty ones included), from
// the last source run: action `when`s have to be synchronous.
let foldersSupported = false;

/** Rows for folders nothing else in the tree makes a folder: empty ones, or
 * ones holding only empty folders deeper down. A page heading an empty
 * folder gets marked as a folder instead of a second row. */
export function withFolderRows(
  contents: TreeObj[],
  folders: string[],
): TreeObj[] {
  if (folders.length === 0) return contents;
  const names = new Set(contents.map((obj) => obj.name));
  // Every folder some row already sits in
  const filled = new Set<string>();
  for (const name of [...names, ...folders]) {
    for (let i = name.indexOf("/"); i !== -1; i = name.indexOf("/", i + 1)) {
      filled.add(name.slice(0, i));
    }
  }
  const empty = new Set(folders.filter((folder) => !filled.has(folder)));
  return [
    ...contents.map((obj) =>
      empty.has(obj.name) ? { ...obj, isFolder: true } : obj,
    ),
    ...[...empty]
      .filter((folder) => !names.has(folder))
      .map((name) => ({ name, isFolder: true })),
  ];
}

async function spaceTreeSource(): Promise<TreeObj[]> {
  const [listed, folders] = await Promise.all([
    spaceContents() as Promise<TreeObj[]>,
    space.listFolders(),
  ]);
  foldersSupported = folders !== null;
  const contents = withFolderRows(listed, folders ?? []);
  const [collate, order] = await Promise.all([
    treeCollate(),
    loadTreeOrder(contents),
  ]);
  const attributes = cachedTreeAttributes();
  lastRows = sortByTreeOrder(
    contents.map((obj) =>
      isTreeHidden(obj, attributes) ? { ...obj, isTreeHidden: true } : obj,
    ),
    order,
    collate,
  );
  siblingIndexes = new Map();
  return lastRows;
}

/** Moves `obj` past its nearest sibling in `segment`, so a move is never
 * spent on a row the user can't see (which keeps its place). */
async function moveAmongSiblings(
  obj: TreeObj,
  step: -1 | 1,
  segment: string | undefined,
): Promise<void> {
  const anchor = siblingIndex(segment).neighbor(obj.name, step);
  if (anchor === undefined) return;
  const { folder, name } = splitPath(obj.name);
  await reorderSibling({
    folder,
    name,
    anchor,
    position: step < 0 ? "before" : "after",
  });
}

/** Renaming means something different for each of the three kinds of row a
 * space tree has, and only the folder case needs a prompt of its own (the
 * other two are the same commands the editor's own rename commands run). */
async function renameTreeRow(obj: TreeObj): Promise<void> {
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

/** Picks the row's icon, saved as `[icon: …]` on its entry in the order
 * page; "No icon" removes it. */
async function pickTreeIcon(obj: TreeObj): Promise<void> {
  const picked = await editor.pickIcon({
    // What the row shows now, so the picker marks the right one as current.
    initial: cachedTreeAttributes().get(obj.name)?.icon ?? treeIcon(obj),
    // Short, like the page picker's "Open": the row it came from says which.
    title: "Tree icon",
  });
  if (picked === undefined) return;
  await setTreeAttribute(obj.name, "icon", picked === "" ? null : picked);
}

/** Hides the row, and with a folder everything under it, by saving
 * `[hide: true]` on its entry in the order page. */
async function hideTreeRow(obj: TreeObj): Promise<void> {
  await setTreeAttribute(obj.name, "hide", "true");
  await editor.flashNotification(
    `Hid ${obj.name} from the tree; remove its [hide: true] in ${TREE_ORDER_PAGE} to show it again`,
  );
}

async function deleteTreeRow(obj: TreeObj): Promise<void> {
  if (!(await editor.confirm(`Delete ${obj.name}?`))) return;
  const file = obj.tag === "document" ? obj.name : `${obj.name}.md`;
  await leaveBeforeDeleting((path) => path === file);
  if (obj.tag === "document") {
    await space.deleteDocument(obj.name);
  } else {
    await space.deletePage(obj.name);
  }
}

function countFiles(names: string[]): string {
  const pages = names.filter((name) => name.endsWith(".md")).length;
  const documents = names.length - pages;
  return [
    pages > 0 ? `${pages} ${pages === 1 ? "page" : "pages"}` : "",
    documents > 0
      ? `${documents} ${documents === 1 ? "document" : "documents"}`
      : "",
  ]
    .filter(Boolean)
    .join(" and ");
}

/** Deletes the folder and everything in it, after asking when that's more
 * than the folder itself. A page heading the folder stays: it lives next to
 * the folder, not in it. */
async function deleteFolderRow(obj: TreeObj): Promise<void> {
  const inside = (path: string) => path.startsWith(`${obj.name}/`);
  const files = (await space.listFiles())
    .map(({ name }) => name)
    .filter(inside);
  if (
    files.length > 0 &&
    !(await editor.confirm(
      `Delete ${obj.name} and the ${countFiles(files)} in it?`,
      { destructive: true },
    ))
  ) {
    return;
  }
  await leaveBeforeDeleting(inside);
  await space.deleteFolder(obj.name, { recursive: true });
}

/** Picks a file and uploads it into the folder (the top of the space for
 * the root), under a name the user confirms. */
async function uploadDocumentTo(obj: TreeObj): Promise<void> {
  await system.invokeFunction("editor.uploadFileTo", obj.name);
}

/** What a name typed for something new in the folder starts with: the
 * folder's own name, or nothing at the top of the space. */
const inFolder = (obj: TreeObj) => (obj.name ? `${obj.name}/` : "");

async function newFolderUnder(obj: TreeObj): Promise<void> {
  const prefill = inFolder(obj);
  const name = await editor.prompt("New folder name:", prefill);
  if (name == null) return;
  const trimmed = name.trim().replace(/\/+$/, "");
  if (trimmed === "" || trimmed === obj.name) return;
  await space.createFolder(trimmed);
}

/** The filter's create row: a page, or a folder for a name ending in "/". */
async function createFromTree(name: string): Promise<void> {
  if (!name.endsWith("/")) {
    await editor.navigate(name);
    return;
  }
  const folder = name.replace(/\/+$/, "");
  if (!folder) return;
  if (!foldersSupported) {
    await editor.flashNotification(
      "This server doesn't keep empty folders; create a page in it instead",
      "error",
    );
    return;
  }
  await space.createFolder(folder);
}

async function newPageUnder(obj: TreeObj): Promise<void> {
  const prefill = inFolder(obj);
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

export const spaceTreeView: BuiltinView<TreeObj> = {
  meta: baseMeta({
    title: "Space",
    label: "Open",
    dock: "lhs",
    supportedDocks: ["lhs", "rhs", "bhs", "modal"],
    mode: "tree",
    followEditor: true,
    hasCreate: true,
    createsFolders: true,
    uploadFiles: true,
    foldersFirst: false,
    // Every folder here names a page, whether or not one exists yet, so
    // clicking one opens that page as well as expanding the row.
    selectableFolders: true,
    refreshOn: expandRefreshTriggers(["index", "folder:changed"]),
  }),
  row: {
    icon: treeIcon,
    cssClass: (obj) => (obj.isTreeHidden ? HIDDEN_ROW_CLASS : undefined),
  },
  segments: spaceTreeSegments,
  actions: [
    {
      icon: "plus",
      label: "New page here",
      requireMode: "rw",
      root: true,
      when: (obj) => obj.isFolder === true,
      run: newPageUnder,
    },
    {
      icon: "folder-plus",
      label: "New folder here",
      requireMode: "rw",
      root: true,
      when: (obj) => obj.isFolder === true && foldersSupported,
      run: newFolderUnder,
    },
    {
      icon: "upload",
      label: "Upload document here",
      requireMode: "rw",
      root: true,
      when: (obj) => obj.isFolder === true,
      run: uploadDocumentTo,
    },
    { icon: "edit-3", label: "Rename", requireMode: "rw", run: renameTreeRow },
    {
      icon: "trash-2",
      label: "Delete",
      requireMode: "rw",
      when: (obj) => !obj.isFolder,
      run: deleteTreeRow,
    },
    {
      icon: "trash-2",
      label: "Delete page",
      requireMode: "rw",
      when: (obj) => obj.isFolder === true && obj.ref != null,
      run: deleteTreeRow,
    },
    {
      icon: "trash-2",
      label: "Delete folder",
      requireMode: "rw",
      when: (obj) => obj.isFolder === true && foldersSupported,
      run: deleteFolderRow,
    },
    {
      icon: "arrow-up",
      label: "Move up",
      requireMode: "rw",
      when: (obj) =>
        siblingIndex(homeSegment(obj)).neighbor(obj.name, -1) !== undefined,
      run: (obj, ctx) =>
        moveAmongSiblings(obj, -1, ctx.segment ?? homeSegment(obj)),
    },
    {
      icon: "arrow-down",
      label: "Move down",
      requireMode: "rw",
      when: (obj) =>
        siblingIndex(homeSegment(obj)).neighbor(obj.name, 1) !== undefined,
      run: (obj, ctx) =>
        moveAmongSiblings(obj, 1, ctx.segment ?? homeSegment(obj)),
    },
    {
      icon: "rotate-ccw",
      label: "Reset order",
      requireMode: "rw",
      when: (obj) => obj.isFolder === true && cachedTreeOrder().has(obj.name),
      run: (obj) => saveFolderOrder(obj.name, null),
    },
    {
      icon: "smile",
      label: "Set icon",
      requireMode: "rw",
      when: (obj) => !obj.isAspiring,
      run: pickTreeIcon,
    },
    {
      icon: "eye-off",
      label: "Hide from tree",
      requireMode: "rw",
      when: (obj) => !obj.isAspiring && !obj.isTreeHidden,
      run: hideTreeRow,
    },
  ],
  keymap: {
    // Peek: open the row without leaving the panel, so the next arrow keeps
    // browsing. `editor.navigate` focuses the editor; the panel takes focus
    // back on its own afterwards.
    " ": (obj) => editor.navigate(obj.ref ?? obj.name),
  },
  onMove: moveByRename,
  onReorder: reorderSibling,
  source: spaceTreeSource,
  onSelect: (obj) => editor.navigate(obj.ref ?? obj.name),
  onCreate: createFromTree,
};
