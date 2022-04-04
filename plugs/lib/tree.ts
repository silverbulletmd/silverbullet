export type MarkdownTree = {
  type?: string; // undefined === text node
  from: number;
  to: number;
  text?: string;
  children?: MarkdownTree[];
  parent?: MarkdownTree;
};

export function addParentPointers(mdTree: MarkdownTree) {
  if (!mdTree.children) {
    return;
  }
  for (let child of mdTree.children) {
    child.parent = mdTree;
    addParentPointers(child);
  }
}

export function removeParentPointers(mdTree: MarkdownTree) {
  delete mdTree.parent;
  if (!mdTree.children) {
    return;
  }
  for (let child of mdTree.children) {
    removeParentPointers(child);
  }
}

export function findParentMatching(
  mdTree: MarkdownTree,
  matchFn: (mdTree: MarkdownTree) => boolean
): MarkdownTree | null {
  let node = mdTree.parent;
  while (node) {
    if (matchFn(node)) {
      return node;
    }
    node = node.parent;
  }
  return null;
}

export function collectNodesMatching(
  mdTree: MarkdownTree,
  matchFn: (mdTree: MarkdownTree) => boolean
): MarkdownTree[] {
  if (matchFn(mdTree)) {
    return [mdTree];
  }
  let results: MarkdownTree[] = [];
  if (mdTree.children) {
    for (let child of mdTree.children) {
      results = [...results, ...collectNodesMatching(child, matchFn)];
    }
  }
  return results;
}

export function findNodeMatching(
  mdTree: MarkdownTree,
  matchFn: (mdTree: MarkdownTree) => boolean
): MarkdownTree | null {
  return collectNodesMatching(mdTree, matchFn)[0];
}

// Finds non-text node at position
export function nodeAtPos(
  mdTree: MarkdownTree,
  pos: number
): MarkdownTree | null {
  if (pos < mdTree.from || pos > mdTree.to) {
    return null;
  }
  if (!mdTree.children) {
    return mdTree;
  }
  for (let child of mdTree.children) {
    let n = nodeAtPos(child, pos);
    if (n && n.text !== undefined) {
      // Got a text node, let's return its parent
      return mdTree;
    } else if (n) {
      // Got it
      return n;
    }
  }
  return null;
}

// Turn MarkdownTree back into regular markdown text
export function render(mdTree: MarkdownTree): string {
  let pieces: string[] = [];
  if (mdTree.text !== undefined) {
    return mdTree.text;
  }
  for (let child of mdTree.children!) {
    pieces.push(render(child));
  }
  return pieces.join("");
}
