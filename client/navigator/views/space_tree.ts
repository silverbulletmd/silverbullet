import {
  config,
  editor,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { compareCollated } from "@silverbulletmd/silverbullet/lib/collation";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { QueryCollationConfig } from "@silverbulletmd/silverbullet/type/config";
import { isMetaPage, spaceContents } from "./pages.ts";
import {
  baseMeta,
  type BuiltinView,
  INDEX_REFRESH_EVENTS,
  type Segment,
} from "./types.ts";

/**
 * A tree row: a real page/document from `spaceContents()` (a genuine
 * `ObjectValue`), or a folder the tree synthesizes client-side from the
 * hierarchy -- which has a `name` and `isFolder`, but neither `ref` nor
 * `tag` of its own (a "dual" -- a folder that is *also* a page -- carries
 * both: everything the real object has, plus `isFolder`). `Partial` is what
 * makes both shapes fit one type: only `name` is ever guaranteed.
 */
type TreeObj = Partial<ObjectValue<Record<string, any>>> & {
  name: string;
  isFolder?: boolean;
};

/** Folder rows (and page/folder duals) arrive as `{ name, isFolder = true }`,
 * synthesized client-side from the tree's own hierarchy -- which is why this
 * leads with `isFolder` rather than with the tag. */
function treeIcon(obj: TreeObj): string {
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

const spaceTreeSegments: Segment<TreeObj>[] = [
  {
    label: "All",
    icon: "layers",
    default: true,
    placeholder: "Page or document",
    // Meta pages are reachable only via the Meta segment.
    where: (obj) => !isMetaPage(obj),
  },
  {
    label: "Pages",
    icon: "file-text",
    placeholder: "Page",
    where: (obj) => obj.tag === "page" && !isMetaPage(obj),
  },
  {
    label: "Documents",
    icon: "file",
    placeholder: "Document",
    where: (obj) => obj.tag === "document",
  },
  {
    label: "Meta",
    icon: "settings",
    placeholder: "Meta page",
    where: isMetaPage,
  },
];

/** `spaceContents()` already degrades pre-index the same way the space
 * picker needs to; the tree wants the identical set, just alphabetical
 * rather than recency-ordered, honouring the same `queryCollation` config
 * the indexed `order by _.name` query path does. */
async function spaceTreeSource(): Promise<TreeObj[]> {
  const contents = await spaceContents();
  const collation = await config.get<QueryCollationConfig>(
    "queryCollation",
    {},
  );
  const collator = Intl.Collator(collation?.locale, collation?.options);
  // A real page/document always has `name` at runtime; `TreeObj` just can't
  // say so statically, since it also has to fit the folders the tree
  // synthesizes client-side (see the type's own doc comment).
  return [...contents].sort((a, b) =>
    compareCollated(String(a.name), String(b.name), collation, collator),
  ) as TreeObj[];
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
    // Matches the modal pickers' chrome: a short verb where the title goes,
    // with the segment naming what it picks in the input's placeholder.
    label: "Open",
    dock: "lhs",
    mode: "tree",
    followEditor: true,
    hasCreate: true,
    foldersFirst: false,
    refreshOn: INDEX_REFRESH_EVENTS,
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
  onSelect: (obj) => editor.navigate(obj.ref ?? obj.name),
  onCreate: (name) => editor.navigate(name),
};
