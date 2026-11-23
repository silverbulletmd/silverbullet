/** Page holding the saved order of the space tree, as a nested list of
 * names. */
export const TREE_ORDER_PAGE = "Library/Space Tree Outline";

/** Folder path (`""` for the root) to its child segment names, in order. */
export type TreeOrder = Map<string, string[]>;

/** Path to the `[key: value]` attributes written after its entry, such as
 * `icon` and `hide`. Kept as written so a rewrite gives them back unchanged. */
export type TreeAttributes = Map<string, Record<string, string>>;

type OrderItem = {
  text: string;
  attributes: Record<string, string>;
  children: OrderItem[];
};

const itemRegex = /^(\s*)[*+-]\s+(.*)$/;
const attributeRegex = /\s*\[([^[\]:]*):([^[\]]*)\]\s*$/;

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function indentWidth(ws: string): number {
  let width = 0;
  for (const ch of ws) width += ch === "\t" ? 4 : 1;
  return width;
}

/** `path`'s folder (`""` at the root) and its last segment. */
export function splitPath(
  path: string,
  separator = "/",
): { folder: string; name: string } {
  const i = path.lastIndexOf(separator);
  return i < 0
    ? { folder: "", name: path }
    : { folder: path.slice(0, i), name: path.slice(i + separator.length) };
}

function join(folder: string, name: string): string {
  return folder === "" ? name : `${folder}/${name}`;
}

/**
 * Finds the first top-level list: returns the offset where it starts and its
 * item forest. The list ends at a non-item line that follows a blank line.
 */
function scanList(text: string): { start: number; roots: OrderItem[] } | null {
  const roots: OrderItem[] = [];
  const stack: { indent: number; item: OrderItem }[] = [];
  let start = -1;
  let blankSeen = false;
  let offset = 0;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const m = itemRegex.exec(line);
    if (!m) {
      if (start >= 0) {
        if (line.trim() === "") blankSeen = true;
        else if (blankSeen) break;
      }
      continue;
    }
    const indent = indentWidth(m[1]);
    if (start < 0) {
      if (indent > 0) continue;
      start = lineStart;
    }
    blankSeen = false;
    let body = m[2].trim();
    const found: [string, string][] = [];
    let attr = attributeRegex.exec(body);
    while (attr) {
      found.unshift([attr[1].trim(), attr[2].trim()]);
      body = body.slice(0, attr.index);
      attr = attributeRegex.exec(body);
    }
    const item: OrderItem = {
      text: body.trim(),
      attributes: Object.fromEntries(found),
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (stack.length === 0) roots.push(item);
    else stack[stack.length - 1].item.children.push(item);
    stack.push({ indent, item });
  }
  return start < 0 ? null : { start, roots };
}

/** Parses the outline into folder -> ordered child names. */
export function parseTreeOrder(text: string): TreeOrder {
  return parseTree(text).order;
}

/** Like `parseTreeOrder`, also returning each entry's attributes. Each entry
 * is a name under its parent entry's path (a name with `/` in it, a path
 * below it). */
export function parseTree(text: string): {
  order: TreeOrder;
  attributes: TreeAttributes;
} {
  const order: TreeOrder = new Map();
  const attributes: TreeAttributes = new Map();
  const list = scanList(normalizeNewlines(text));
  if (!list) return { order, attributes };

  const add = (folder: string, name: string) => {
    const names = order.get(folder) ?? [];
    if (!names.includes(name)) names.push(name);
    order.set(folder, names);
  };
  const visit = (item: OrderItem, parentPath: string) => {
    const path = item.text === "" ? "" : join(parentPath, item.text);
    const { folder, name } = splitPath(path);
    if (name === "") {
      // Contributes nothing; children resolve against the parent's path.
      for (const child of item.children) visit(child, parentPath);
      return;
    }
    // `[order: auto]`: written for context (to nest what's below it, or to
    // carry attributes), not placed among its siblings
    const { [AUTO_KEY]: placement, ...attrs } = item.attributes;
    if (placement !== AUTO_VALUE) add(folder, name);
    if (Object.keys(attrs).length > 0) {
      attributes.set(path, { ...attributes.get(path), ...attrs });
    }
    for (const child of item.children) visit(child, path);
  };
  for (const root of list.roots) visit(root, "");
  return { order, attributes };
}

/** What a rewrite keeps ahead of the list: everything before the first
 * top-level item, or -- when there is no list -- all of the text. */
export function treeOrderPreamble(text: string): string {
  const normalized = normalizeNewlines(text);
  const list = scanList(normalized);
  if (list) return normalized.slice(0, list.start);
  return normalized.trim() === "" ? "" : `${normalized.trimEnd()}\n\n`;
}

/** The marker on an entry that is in the outline only for context: to nest
 * an ordered folder under its parents, or to carry attributes. It keeps
 * its alphabetical place instead of being pinned among its siblings. */
const AUTO_KEY = "order";
const AUTO_VALUE = "auto";

/**
 * Renders the outline: preamble followed by one nested list, as short as it
 * can be. It holds the folders with a saved order (their children in that
 * order), entries with attributes, and the folders above those -- the
 * latter two marked `[order: auto]` where their own folder has no saved
 * order, so writing them doesn't pin them. An entry is kept while `exists`
 * says its page, document or folder is still there (or something below it
 * is).
 */
export function renderTreeOrder(
  preamble: string,
  order: TreeOrder,
  exists: (path: string) => boolean,
  attributes: TreeAttributes = new Map(),
): string {
  // Every path the outline has to show, and so every folder above them.
  const needed = new Set<string>();
  const need = (path: string) => {
    for (let p = path; p !== "" && !needed.has(p); p = splitPath(p).folder) {
      needed.add(p);
    }
  };
  for (const [folder, names] of order) {
    need(folder);
    for (const name of names) if (name !== "") need(join(folder, name));
  }
  for (const path of attributes.keys()) need(path);
  const context = new Map<string, string[]>();
  for (const path of needed) {
    const { folder, name } = splitPath(path);
    if (order.get(folder)?.includes(name)) continue;
    context.set(folder, [...(context.get(folder) ?? []), name]);
  }

  const suffix = (path: string, auto: boolean) =>
    (auto ? ` [${AUTO_KEY}: ${AUTO_VALUE}]` : "") +
    Object.entries(attributes.get(path) ?? {})
      .map(([key, value]) => ` [${key}: ${value}]`)
      .join("");
  const walk = (folder: string, depth: number): string[] => {
    const lines: string[] = [];
    const pad = "  ".repeat(depth);
    const pinned = (order.get(folder) ?? []).filter((name) => name !== "");
    const auto = (context.get(folder) ?? []).sort();
    for (const [name, isAuto] of [
      ...pinned.map((n): [string, boolean] => [n, false]),
      ...auto.map((n): [string, boolean] => [n, true]),
    ]) {
      const path = join(folder, name);
      const children = walk(path, depth + 1);
      if (children.length > 0 || exists(path)) {
        lines.push(`${pad}* ${name}${suffix(path, isAuto)}`, ...children);
      }
    }
    return lines;
  };
  return `${preamble}${walk("", 0).join("\n")}\n`;
}

/**
 * Applies renames (old path to new path, both as tree names) to a saved
 * order. A renamed entry keeps its place when it stays in its folder, and
 * its attributes follow it. When the renames empty a folder into another one
 * (`A/x` to `B/x` and nothing left under `A`), that folder's order moves
 * along too. `exists` and `isFolder` describe the space after the renames:
 * a page renamed away from the pages under it leaves its folder's entry
 * where it was. Returns whether anything changed.
 */
export function renameInTreeOrder(
  order: TreeOrder,
  attributes: TreeAttributes,
  renames: [string, string][],
  exists: (path: string) => boolean,
  isFolder: (path: string) => boolean,
): boolean {
  const moves = new Map<string, string>();
  for (const [from, to] of renames) {
    if (from === to) continue;
    moves.set(from, to);
    // `A/B/x` to `C/B/x` moves `A/B` to `C/B` and `A` to `C` as well --
    // when nothing is left under them.
    const a = from.split("/");
    const b = to.split("/");
    while (a.length > 1 && b.length > 1 && a.at(-1) === b.at(-1)) {
      a.pop();
      b.pop();
      const folder = a.join("/");
      if (!isFolder(folder)) moves.set(folder, b.join("/"));
    }
  }
  let changed = false;
  const rekey = <T>(map: Map<string, T>, gone: (path: string) => boolean) => {
    for (const [from, to] of moves) {
      if (gone(from) && map.has(from) && !map.has(to)) {
        map.set(to, map.get(from)!);
        map.delete(from);
        changed = true;
      }
    }
  };
  // Re-key first: a moved folder takes its children's order along, so the
  // entries below find nothing left to update under the old folder.
  rekey(order, (path) => !isFolder(path));
  rekey(attributes, (path) => !exists(path));
  for (const [from, to] of moves) {
    const old = splitPath(from);
    const siblings = order.get(old.folder);
    const i = siblings?.indexOf(old.name) ?? -1;
    if (!siblings || i < 0) continue;
    const moved = splitPath(to);
    const place = moved.folder === old.folder && !siblings.includes(moved.name);
    if (exists(from)) {
      // Still there (a folder, or a page left behind): it keeps its entry,
      // the new name lands right after it.
      if (place) siblings.splice(i + 1, 0, moved.name);
    } else if (place) {
      siblings[i] = moved.name;
    } else {
      siblings.splice(i, 1);
    }
    changed ||= place || !exists(from);
  }
  return changed;
}

/**
 * Compares two tree paths segment by segment. At the first differing segment,
 * unlisted names come first (via `collate`), then listed names in saved order.
 * A path that is a prefix of the other comes first.
 */
export function compareTreePaths(
  a: string,
  b: string,
  order: TreeOrder,
  collate: (x: string, y: string) => number,
): number {
  const as = a.split("/");
  const bs = b.split("/");
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    if (as[i] === bs[i]) continue;
    const siblings = order.get(as.slice(0, i).join("/")) ?? [];
    const ra = siblings.indexOf(as[i]);
    const rb = siblings.indexOf(bs[i]);
    if (ra < 0 && rb < 0) return collate(as[i], bs[i]);
    return ra - rb;
  }
  return as.length - bs.length;
}

/**
 * Returns `current` with `name` moved (or added) before/after `anchor`;
 * a null or unknown anchor puts it at the end.
 */
export function placeSibling(
  current: string[],
  name: string,
  anchor: string | null,
  position: "before" | "after",
): string[] {
  const rest = current.filter((n) => n !== name);
  const i = anchor === null ? -1 : rest.indexOf(anchor);
  if (i < 0) return [...rest, name];
  rest.splice(position === "before" ? i : i + 1, 0, name);
  return rest;
}

/**
 * The folders a set of paths implies: each folder's children in first-seen
 * order, folders without a page of their own included.
 */
export class TreeIndex {
  private readonly children = new Map<string, string[]>();
  /** Each path's index among its folder's children. */
  private readonly position = new Map<string, number>();

  constructor(paths: Iterable<string>) {
    for (const path of paths) {
      let folder = "";
      for (const name of path.split("/")) {
        const full = join(folder, name);
        if (!this.position.has(full)) {
          let siblings = this.children.get(folder);
          if (!siblings) {
            siblings = [];
            this.children.set(folder, siblings);
          }
          this.position.set(full, siblings.length);
          siblings.push(name);
        }
        folder = full;
      }
    }
  }

  /** `folder`'s (`""` = root) immediate child names. */
  childrenOf(folder: string): string[] {
    return this.children.get(folder) ?? [];
  }

  /** Whether anything lives under `path`. */
  isFolder(path: string): boolean {
    return this.children.has(path);
  }

  /** The sibling `step` places from `path` (-1 above, 1 below). */
  neighbor(path: string, step: -1 | 1): string | undefined {
    const i = this.position.get(path);
    if (i === undefined) return undefined;
    return this.childrenOf(splitPath(path).folder)[i + step];
  }
}
