import type { Row } from "./tree_types.ts";

export type TreeNode = {
  path: string;
  segment: string;
  row?: Row;
  children: TreeNode[];
  isFolder: boolean;
};

export type VisibleRow = { node: TreeNode; depth: number };

export function buildTree(
  rows: Row[],
  separator: string,
  foldersFirst: boolean,
): TreeNode {
  const root: TreeNode = {
    path: "",
    segment: "",
    children: [],
    isFolder: true,
  };
  const byPath = new Map<string, TreeNode>([["", root]]);
  const ensure = (path: string): TreeNode => {
    let node = byPath.get(path);
    if (node) return node;
    const idx = path.lastIndexOf(separator);
    const parent = ensure(idx === -1 ? "" : path.slice(0, idx));
    node = {
      path,
      segment: idx === -1 ? path : path.slice(idx + separator.length),
      children: [],
      isFolder: false,
    };
    byPath.set(path, node);
    parent.children.push(node);
    parent.isFolder = true;
    return node;
  };
  for (const row of rows) {
    const path = String(row.obj.name ?? row.primary);
    ensure(path).row = row;
  }
  if (foldersFirst) {
    const sortLevel = (n: TreeNode) => {
      n.children = [
        ...n.children.filter((c) => c.isFolder),
        ...n.children.filter((c) => !c.isFolder),
      ];
      n.children.forEach(sortLevel);
    };
    sortLevel(root);
  }
  return root;
}

export function flattenVisible(
  root: TreeNode,
  expanded: Set<string>,
): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (node: TreeNode, depth: number) => {
    for (const child of node.children) {
      out.push({ node: child, depth });
      if (child.isFolder && expanded.has(child.path)) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export function pruneTree(
  root: TreeNode,
  scores: Map<string, number>,
): TreeNode {
  // Post-order: each node's best score is computed once, from its
  // already-scored children, rather than re-walked on every sort comparison.
  const bestScores = new Map<TreeNode, number>();
  const prune = (n: TreeNode): TreeNode | null => {
    const children = n.children
      .map(prune)
      .filter((c): c is TreeNode => c !== null);
    if (children.length === 0 && !scores.has(n.path)) return null;
    const copy = { ...n, children };
    bestScores.set(
      copy,
      Math.max(
        scores.get(n.path) ?? -1,
        ...children.map((c) => bestScores.get(c)!),
      ),
    );
    copy.children.sort((a, b) => bestScores.get(b)! - bestScores.get(a)!);
    return copy;
  };
  return prune(root) ?? { ...root, children: [] };
}

export function ancestorPaths(path: string, separator: string): string[] {
  const parts = path.split(separator);
  return parts
    .slice(0, -1)
    .map((_, i) => parts.slice(0, i + 1).join(separator));
}

/**
 * `prev` with `paths` expanded. Under `expandAll` expanding is a *removal*:
 * the set holds what the user collapsed, and everything not in it is already
 * open. Toggling needs no such branch -- flipping membership means "collapse"
 * under one reading and "expand" under the other, which is the same gesture.
 */
export function withExpanded(
  prev: Set<string>,
  paths: string[],
  expandAll: boolean,
): Set<string> {
  const next = new Set(prev);
  for (const path of paths) {
    if (expandAll) next.delete(path);
    else next.add(path);
  }
  return next;
}

export function allFolderPaths(node: TreeNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: TreeNode) => {
    for (const child of n.children) {
      if (child.isFolder) {
        out.add(child.path);
        walk(child);
      }
    }
  };
  walk(node);
  return out;
}

/**
 * The object a node hands to a caller. A copy, deliberately: `isFolder` is a
 * UI-injected hint, and stamping it onto the row's own object would leave it
 * on the caller's cached row forever. Same shape `planMove` produces, so a
 * folder reaches downstream code looking the same either way.
 */
export function nodeObject(node: TreeNode): Record<string, any> {
  const obj: Record<string, any> = node.row
    ? { ...node.row.obj }
    : { name: node.path };
  if (node.isFolder) obj.isFolder = true;
  return obj;
}

/** Every node under `root`, in tree order (the root itself excluded). */
export function allNodes(root: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    for (const child of n.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

export function findNode(root: TreeNode, path: string): TreeNode | undefined {
  if (path === root.path) return root;
  for (const child of root.children) {
    if (path === child.path) return child;
    if (path.startsWith(child.path)) {
      const found = findNode(child, path);
      if (found) return found;
    }
  }
  return undefined;
}

export type MovePlan =
  | { kind: "none" }
  | { kind: "collision"; newName: string }
  | { kind: "move"; obj: Record<string, any>; newName: string };

/**
 * What dropping `draggedPath` on `targetFolder` (`""` = root) amounts to: the
 * new name, the object to hand the mover, or a reason not to move at all.
 * Kept here, away from the DOM, because every interesting case is a
 * path/tree question -- and the drop handler must not guess at any of them.
 */
export function planMove(
  root: TreeNode,
  draggedPath: string,
  targetFolder: string,
  separator: string,
): MovePlan {
  if (!draggedPath || draggedPath === targetFolder) return { kind: "none" };
  // Into its own subtree: the prefix rename would chase itself.
  if (targetFolder.startsWith(draggedPath + separator)) return { kind: "none" };
  const idx = draggedPath.lastIndexOf(separator);
  const segment =
    idx === -1 ? draggedPath : draggedPath.slice(idx + separator.length);
  const newName =
    targetFolder === "" ? segment : targetFolder + separator + segment;
  if (newName === draggedPath) return { kind: "none" };
  const node = findNode(root, draggedPath);
  if (!node) return { kind: "none" };
  // Any node, not just row-bearing ones: dropping onto a name that already
  // exists as a folder would merge two subtrees, silently overwriting every
  // page whose name appears in both.
  if (findNode(root, newName)) return { kind: "collision", newName };
  return { kind: "move", obj: nodeObject(node), newName };
}

export type TreeDisplay = {
  tree: TreeNode;
  visible: VisibleRow[];
  effectiveExpanded: Set<string>;
};

/**
 * Combines build + (optional) prune + auto-expand-while-filtering + flatten
 * into the single derivation both a tree renderer and its host's keyboard
 * math need, so they never compute two different visible-row lists.
 *
 * `effectiveExpanded` is the one answer to "is this folder open", whichever
 * reading `state` has: everything downstream -- the chevrons, `ArrowLeft`,
 * spring-loading -- asks it and never the raw set.
 *
 * @param state the persisted set, and how to read it: the folders the user
 * opened, or (under `expandAll`) the ones they closed.
 */
export function computeTreeDisplay(
  rows: Row[],
  separator: string,
  foldersFirst: boolean,
  state: { expanded: Set<string>; expandAll: boolean },
  scores?: Map<string, number>,
): TreeDisplay {
  const built = buildTree(rows, separator, foldersFirst);
  const tree = scores ? pruneTree(built, scores) : built;
  // Filtering force-expands the pruned tree either way, so the two readings
  // converge there and neither set is consulted -- no double bookkeeping.
  let effectiveExpanded: Set<string>;
  if (scores) {
    effectiveExpanded = allFolderPaths(tree);
  } else if (state.expandAll) {
    effectiveExpanded = allFolderPaths(tree);
    for (const path of state.expanded) effectiveExpanded.delete(path);
  } else {
    effectiveExpanded = state.expanded;
  }
  const visible = flattenVisible(tree, effectiveExpanded);
  return { tree, visible, effectiveExpanded };
}
