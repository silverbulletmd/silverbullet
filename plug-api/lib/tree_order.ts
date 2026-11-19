import { wikiLinkRegex } from "../../client/markdown_parser/constants.ts";

/** Page holding the saved order of the space tree, as a nested list of
 * names. Older versions wrote wiki links; those still read. */
export const TREE_ORDER_PAGE = "Library/Space Tree Structure";

/** Folder path (`""` for the root) to its child segment names, in order. */
export type TreeOrder = Map<string, string[]>;

/** Path to the `[key: value]` attributes written after its entry, such as
 * `icon` and `hide`. Kept as written so a rewrite gives them back unchanged. */
export type TreeAttributes = Map<string, Record<string, string>>;

type OrderItem = {
  /** Link target (as older versions wrote entries), or null for plain text */
  link: string | null;
  text: string;
  attributes: Record<string, string>;
  children: OrderItem[];
};

const itemRegex = /^(\s*)[*+-]\s+(.*)$/;
const attributeRegex = /\s*\[([^[\]:]*):([^[\]]*)\]\s*$/;
// SilverBullet's own wiki link syntax, anchored to the whole item body.
const linkRegex = new RegExp(`^${wikiLinkRegex.source}$`);

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

/** `path` with its last `n` segments dropped. */
function ancestorOf(path: string, n: number): string {
  const segs = path.split("/");
  return segs.slice(0, Math.max(0, segs.length - n)).join("/");
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
    body = body.trim();
    const ref = linkRegex.exec(body)?.groups?.stringRef;
    const item: OrderItem = {
      // A body holding two links (`[[A]] and [[B]]`) is text, not one link.
      link: ref === undefined || ref.includes("]]") ? null : ref.trim(),
      text: body,
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

/**
 * Parses the order page into folder -> ordered child names. `resolve` maps a
 * link target as written (a bare or wrong-case name, say) to the path it
 * stands for; targets it does not know should come back unchanged.
 */
export function parseTreeOrder(
  text: string,
  resolve: (target: string) => string = (target) => target,
): TreeOrder {
  return parseTree(text, resolve).order;
}

/** Like `parseTreeOrder`, also returning each entry's attributes. */
export function parseTree(
  text: string,
  resolve: (target: string) => string = (target) => target,
): { order: TreeOrder; attributes: TreeAttributes } {
  const order: TreeOrder = new Map();
  const attributes: TreeAttributes = new Map();
  const list = scanList(normalizeNewlines(text));
  if (!list) return { order, attributes };
  const resolveAll = (items: OrderItem[]) => {
    for (const item of items) {
      if (item.link !== null) item.link = resolve(item.link);
      resolveAll(item.children);
    }
  };
  resolveAll(list.roots);

  const add = (folder: string, name: string) => {
    const names = order.get(folder) ?? [];
    if (!names.includes(name)) names.push(name);
    order.set(folder, names);
  };
  // Where each descendant link puts `item`: the link's target with one
  // segment dropped per level of nesting below `item`.
  const places = (item: OrderItem, depth = 1): string[] =>
    item.children.flatMap((c) =>
      (c.link === null ? [] : [ancestorOf(c.link, depth)]).concat(
        places(c, depth + 1),
      ),
    );
  const commonPrefix = (paths: string[]): string => {
    const split = paths.map((t) => t.split("/").filter(Boolean));
    let common = split[0];
    for (const segs of split.slice(1)) {
      let i = 0;
      while (i < common.length && i < segs.length && common[i] === segs[i]) i++;
      common = common.slice(0, i);
    }
    return common.join("/");
  };
  const visit = (item: OrderItem, parentPath: string) => {
    let path: string;
    if (item.link !== null) {
      path = item.link;
    } else {
      const targets = places(item);
      if (targets.length > 0) {
        path =
          commonPrefix(targets) ||
          (item.text === "" ? "" : join(parentPath, item.text));
      } else if (item.text.includes("/")) {
        // A folder written without its parent item: its full path.
        path = item.text;
      } else {
        path = item.text === "" ? "" : join(parentPath, item.text);
      }
    }
    const { folder, name } = splitPath(path);
    if (name === "") {
      // Contributes nothing; children resolve against the parent's path.
      for (const child of item.children) visit(child, parentPath);
      return;
    }
    add(folder, name);
    if (Object.keys(item.attributes).length > 0) {
      attributes.set(path, { ...attributes.get(path), ...item.attributes });
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

/**
 * Renders the canonical order page: preamble followed by the nested list of
 * plain names -- full paths at the top level, where no parent item gives
 * context. An entry is kept while `exists` says its page, document or folder
 * is still there (or something below it is).
 */
export function renderTreeOrder(
  preamble: string,
  order: TreeOrder,
  exists: (path: string) => boolean,
  attributes: TreeAttributes = new Map(),
): string {
  const suffix = (path: string) =>
    Object.entries(attributes.get(path) ?? {})
      .map(([key, value]) => ` [${key}: ${value}]`)
      .join("");
  const reached = new Set<string>();
  const walk = (folder: string, depth: number): string[] => {
    reached.add(folder);
    const lines: string[] = [];
    const pad = "  ".repeat(depth);
    for (const name of order.get(folder) ?? []) {
      if (name === "") continue;
      const path = join(folder, name);
      const children = walk(path, depth + 1);
      if (children.length > 0 || exists(path)) {
        lines.push(
          `${pad}* ${depth === 0 ? path : name}${suffix(path)}`,
          ...children,
        );
      }
    }
    return lines;
  };
  const lines = walk("", 0);
  // Folders with a saved order that the root walk did not reach (no saved
  // order on the way down) become top-level groups, so they are not lost.
  for (const folder of [...order.keys()].sort()) {
    if (!reached.has(folder)) lines.push(...walk(folder, 0));
  }
  return `${preamble}${lines.join("\n")}\n`;
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
