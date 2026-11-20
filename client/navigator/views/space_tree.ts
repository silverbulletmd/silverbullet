import {
  splitPath,
  TREE_ORDER_PAGE,
  type TreeAttributes,
  TreeIndex,
} from "@silverbulletmd/silverbullet/lib/tree_order";
import { editor, space, system } from "@silverbulletmd/silverbullet/syscalls";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { expandRefreshTriggers } from "../refresh_triggers.ts";
import { inLibrary, isHiddenPage, spaceContents } from "./pages.ts";
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

export const spaceTreeSegments: Segment<TreeObj>[] = [
  {
    label: "All",
    icon: "layers",
    default: true,
    placeholder: "Page or document",
    // `Library/` shows only under Tool Pages
    where: (obj) => !inLibrary(obj),
  },
  {
    label: "Pages",
    icon: "file-text",
    placeholder: "Page",
    where: (obj) => obj.tag === "page" && !inLibrary(obj),
  },
  {
    label: "Documents",
    icon: "file",
    placeholder: "Document",
    where: (obj) => obj.tag === "document" && !inLibrary(obj),
  },
  {
    label: "Tool Pages",
    icon: "wrench",
    placeholder: "Tool page",
    where: inLibrary,
  },
];

/** Unlike the picker, the tree has no segment that keeps hidden pages: a page
 * hidden from navigation is hidden here too, and `tree.hide` hides it from
 * here alone. A hidden page with children still leaves its folder behind --
 * the folder is synthesized from the children's names. */
function isTreeHidden(obj: TreeObj): boolean {
  return isHiddenPage(obj) || obj.pageDecoration?.tree?.hide === true;
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
 * segments, so Move up/down judge a row where it lives (All or Tool Pages);
 * in a narrower segment a move may find nothing to pass, and does nothing. */
function homeSegment(obj: TreeObj): string | undefined {
  return spaceTreeSegments.find((s) => admits(s, obj))?.label;
}

async function spaceTreeSource(): Promise<TreeObj[]> {
  const contents = (await spaceContents()) as TreeObj[];
  const [collate, order] = await Promise.all([
    treeCollate(),
    loadTreeOrder(contents),
  ]);
  const attributes = cachedTreeAttributes();
  lastRows = sortByTreeOrder(
    contents.filter(
      (obj) => !isTreeHidden(obj) && !hiddenByStructure(obj.name, attributes),
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

async function moveByRename(obj: TreeObj, newName: string): Promise<void> {
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
  if (obj.tag === "document") {
    await space.deleteDocument(obj.name);
  } else {
    await space.deletePage(obj.name);
  }
}

async function newPageUnder(obj: TreeObj): Promise<void> {
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
function isDeletable(obj: TreeObj): boolean {
  return !obj.isFolder || obj.ref != null;
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
    uploadFiles: true,
    foldersFirst: false,
    // Every folder here names a page, whether or not one exists yet, so
    // clicking one opens that page as well as expanding the row.
    selectableFolders: true,
    refreshOn: expandRefreshTriggers(["index"]),
  }),
  row: {
    icon: treeIcon,
  },
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
      requireMode: "rw",
      when: isDeletable,
      run: deleteTreeRow,
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
      when: (obj) => !obj.isAspiring,
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
  onCreate: (name) => editor.navigate(name),
};
