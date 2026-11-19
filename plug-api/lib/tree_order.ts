import { wikiLinkRegex } from "../../client/markdown_parser/constants.ts";

/** Page holding the saved order of the space tree, as a nested list of wiki links. */
export const TREE_ORDER_PAGE = "Library/Space Tree Structure";

/** Folder path (`""` for the root) to its child segment names, in order. */
export type TreeOrder = Map<string, string[]>;

type OrderItem = {
  /** Link target, or null for plain text */
  link: string | null;
  text: string;
  children: OrderItem[];
};

const itemRegex = /^(\s*)[*+-]\s+(.*)$/;
const attributeRegex = /\s*\[[^[\]]*:[^[\]]*\]\s*$/;
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
    while (attributeRegex.test(body)) body = body.replace(attributeRegex, "");
    body = body.trim();
    const ref = linkRegex.exec(body)?.groups?.stringRef;
    const item: OrderItem = {
      // A body holding two links (`[[A]] and [[B]]`) is text, not one link.
      link: ref === undefined || ref.includes("]]") ? null : ref.trim(),
      text: body,
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
  const order: TreeOrder = new Map();
  const list = scanList(normalizeNewlines(text));
  if (!list) return order;
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
    for (const child of item.children) visit(child, path);
  };
  for (const root of list.roots) visit(root, "");
  return order;
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
 * Renders the canonical order page: preamble followed by the nested list.
 * `isFolder` marks page-less folders that exist (have descendants) so they
 * keep their place even without a saved order of their own.
 */
export function renderTreeOrder(
  preamble: string,
  order: TreeOrder,
  isFile: (path: string) => boolean,
  isFolder: (path: string) => boolean = () => false,
): string {
  const reached = new Set<string>();
  const walk = (folder: string, depth: number): string[] => {
    reached.add(folder);
    const lines: string[] = [];
    const pad = "  ".repeat(depth);
    for (const name of order.get(folder) ?? []) {
      if (name === "") continue;
      const path = join(folder, name);
      const children = walk(path, depth + 1);
      if (isFile(path)) {
        lines.push(`${pad}* [[${path}]]`, ...children);
      } else if (children.length > 0 || isFolder(path)) {
        // At the top level no parent item gives context: write the full path.
        lines.push(`${pad}* ${depth === 0 ? path : name}`, ...children);
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
