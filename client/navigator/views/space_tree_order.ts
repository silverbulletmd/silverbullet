import { compareCollated } from "@silverbulletmd/silverbullet/lib/collation";
import type { Path } from "@silverbulletmd/silverbullet/lib/ref";
import {
  BasenameIndex,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve_path";
import {
  compareTreePaths,
  parseTree,
  placeSibling,
  renameInTreeOrder,
  renderTreeOrder,
  splitPath,
  TREE_ORDER_PAGE,
  type TreeAttributes,
  TreeIndex,
  type TreeOrder,
  treeOrderPreamble,
} from "@silverbulletmd/silverbullet/lib/tree_order";
import { config, editor, space } from "@silverbulletmd/silverbullet/syscalls";
import type { QueryCollationConfig } from "@silverbulletmd/silverbullet/type/config";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { ReorderRequest } from "../types.ts";
import { spaceContents } from "./pages.ts";

// Every listed page or document has a name; `PageObj` just doesn't say so.
type ContentObj = Partial<ObjectValue<Record<string, any>>> & { name: string };

async function listContents(): Promise<ContentObj[]> {
  return (await spaceContents()) as ContentObj[];
}

/** Heads a freshly created order page. */
const EXPLANATION =
  "The order of the space tree. Drag rows in the tree to change it, or edit this list.";

/** The parsed order page, keyed by the `lastModified` it was read at, so the
 * (cheap) list refresh does not re-read and re-parse it every time. `ours`
 * marks an order we just wrote: it stands until the listing shows the page
 * at a new `lastModified`. */
let cache: {
  order: TreeOrder;
  attributes: TreeAttributes;
  modified?: number | string;
  ours: boolean;
} | null = null;

/** Maps a link target as written (bare, a path suffix, wrong case) to the
 * listed name it resolves to, by SilverBullet's own link resolution rule.
 * Unknown or ambiguous targets stay as written. */
function linkResolver(names: string[]): (target: string) => string {
  const index = new BasenameIndex();
  index.rebuild(names);
  return (target) => {
    const r = resolvePath(target as Path, TREE_ORDER_PAGE as Path, index);
    return r.exists && !r.ambiguous ? r.path : target;
  };
}

/** Reads the saved tree order from the order page's entry in `contents`.
 * Re-reads the page only when its `lastModified` differs from the cache. */
export async function loadTreeOrder(
  contents: { name: string; lastModified?: number | string }[],
): Promise<TreeOrder> {
  const page = contents.find((obj) => obj.name === TREE_ORDER_PAGE);
  if (!page) {
    // A freshly written order page may not be listed yet (index lag).
    if (!cache?.ours) cache = null;
    return cache?.order ?? new Map();
  }
  if (cache && cache.modified === page.lastModified) return cache.order;
  let text: string;
  try {
    text = await space.readPage(TREE_ORDER_PAGE);
  } catch {
    // Deleted between listing and reading, or a failed read: an unordered
    // tree beats no tree, and nothing is cached so the next load retries.
    return new Map();
  }
  const { order, attributes } = parseTree(
    text,
    linkResolver(contents.map((obj) => obj.name)),
  );
  cache = { order, attributes, modified: page.lastModified, ours: false };
  return order;
}

/** The order as of the last load (or write), for synchronous callers. */
export function cachedTreeOrder(): TreeOrder {
  return cache?.order ?? new Map();
}

/** The `[key: value]` attributes as of the last load (or write). */
export function cachedTreeAttributes(): TreeAttributes {
  return cache?.attributes ?? new Map();
}

/** Shows our own just-written order immediately; the cache key is left alone,
 * so the next `lastModified` change replaces it with what is on disk. */
export function primeTreeOrder(
  order: TreeOrder,
  attributes: TreeAttributes = cache?.attributes ?? new Map(),
): void {
  cache = { order, attributes, modified: cache?.modified, ours: true };
}

export function sortByTreeOrder<T extends { name: string }>(
  objs: T[],
  order: TreeOrder,
  collate: (a: string, b: string) => number,
): T[] {
  return [...objs].sort((a, b) =>
    compareTreePaths(String(a.name), String(b.name), order, collate),
  );
}

/** How the tree collates names it has no saved order for: the space's
 * `queryCollation` config, same as queries. */
export async function treeCollate(): Promise<(a: string, b: string) => number> {
  const collation = await config.get<QueryCollationConfig>(
    "queryCollation",
    {},
  );
  const collator = Intl.Collator(collation?.locale, collation?.options);
  return (a, b) => compareCollated(a, b, collation, collator);
}

/** `folder`'s children as the tree shows them now: all of them, including
 * ones the current segment hides, in saved order. */
async function currentSiblings(folder: string): Promise<string[]> {
  const contents = await listContents();
  const order = await loadTreeOrder(contents);
  const prefix = folder === "" ? "" : `${folder}/`;
  return sortByTreeOrder(
    new TreeIndex(contents.map((obj) => obj.name))
      .childrenOf(folder)
      .map((name) => ({ name: prefix + name })),
    order,
    await treeCollate(),
  ).map((obj) => obj.name.slice(prefix.length));
}

/** Moves `req.name` before/after `req.anchor` among all of `req.folder`'s
 * children -- including ones the current segment hides -- and saves it. */
export async function reorderSibling(req: ReorderRequest): Promise<void> {
  await saveFolderOrder(
    req.folder,
    placeSibling(
      await currentSiblings(req.folder),
      req.name,
      req.anchor,
      req.position,
    ),
  );
}

/** Sets the `[key: value]` attribute on `path`'s entry in the order page,
 * or removes it when `value` is null. An entry has to be listed to carry
 * attributes: one that isn't yet gets listed by saving its folder's current
 * order, so nothing moves. */
export async function setTreeAttribute(
  path: string,
  key: string,
  value: string | null,
): Promise<void> {
  const { folder, name } = splitPath(path);
  const siblings = await currentSiblings(folder);
  await updateTreeOrder((order, attributes) => {
    const attrs = { ...attributes.get(path) };
    if (value === null) delete attrs[key];
    else attrs[key] = value;
    if (Object.keys(attrs).length > 0) attributes.set(path, attrs);
    else attributes.delete(path);
    if (value !== null && !order.get(folder)?.includes(name)) {
      // The index may not list it yet; it still needs its entry.
      order.set(
        folder,
        siblings.includes(name) ? siblings : [...siblings, name],
      );
    }
    return true;
  });
}

/** Saves `names` as the order of `folder`'s children; `null` forgets the
 * folder's order (back to alphabetical). */
export async function saveFolderOrder(
  folder: string,
  names: string[] | null,
): Promise<void> {
  await updateTreeOrder((order) => {
    if (names === null) order.delete(folder);
    else order.set(folder, names);
    return true;
  });
}

/** Follows renames made inside SilverBullet (`file:renamed`, file paths) in
 * the order page, so renamed pages, documents and folders keep their place. */
export async function followRenames(
  renames: { from: string; to: string }[],
): Promise<void> {
  const treeName = (path: string) =>
    path.endsWith(".md") ? path.slice(0, -3) : path;
  const pairs = renames.map(({ from, to }): [string, string] => [
    treeName(from),
    treeName(to),
  ]);
  await updateTreeOrder(
    (order, attributes, { exists, isFolder }) =>
      renameInTreeOrder(order, attributes, pairs, exists, isFolder),
    { create: false },
  );
}

/** Rewrites the whole order page after `change` edits its parsed order,
 * building on its text on disk: the index may not have caught up with it (a
 * hand edit, a sync, a write a moment ago). `change` returns whether it
 * changed anything; nothing is written when it didn't, nor -- unless
 * `create` -- when there is no order page yet. */
async function updateTreeOrder(
  change: (
    order: TreeOrder,
    attributes: TreeAttributes,
    known: {
      exists: (path: string) => boolean;
      isFolder: (path: string) => boolean;
    },
  ) => boolean,
  { create = true } = {},
): Promise<void> {
  const [currentPage, pages, documents] = await Promise.all([
    editor.getCurrentPage(),
    space.listPages(),
    space.listDocuments(),
  ]);
  const allNames = [...pages, ...documents].map((file) => file.name);
  const open = currentPage === TREE_ORDER_PAGE;
  // Someone may have the order page open, perhaps with unsaved hand edits:
  // save those first so they are what we build on.
  if (open) await editor.save();
  let text: string | undefined;
  try {
    text = await space.readPage(TREE_ORDER_PAGE);
  } catch {
    // Not created yet -- unless it is listed: then writing now would rebuild
    // it from an empty order and wipe every other folder's arrangement.
    if (allNames.includes(TREE_ORDER_PAGE)) {
      throw new Error(`Could not read ${TREE_ORDER_PAGE}`);
    }
    if (!create) return;
  }
  const { order, attributes } =
    text === undefined
      ? { order: new Map() as TreeOrder, attributes: new Map() }
      : parseTree(text, linkResolver(allNames));
  const files = new Set(allNames);
  const tree = new TreeIndex(allNames);
  const isFolder = (path: string) => tree.isFolder(path);
  const exists = (path: string) => files.has(path) || isFolder(path);
  if (!change(order, attributes, { exists, isFolder })) return;

  const previous = cache;
  primeTreeOrder(order, attributes);
  try {
    await space.writePage(
      TREE_ORDER_PAGE,
      renderTreeOrder(
        (text === undefined ? "" : treeOrderPreamble(text)) ||
          `${EXPLANATION}\n\n`,
        order,
        exists,
        attributes,
      ),
    );
  } catch (e) {
    // Don't keep showing an order that never made it to disk.
    cache = previous;
    throw e;
  }
  // The editor doesn't follow a write it didn't make: show the new text.
  if (open) await editor.reloadPage();
}
