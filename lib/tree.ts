export type ParseTree = {
  type?: string; // undefined === text node
  from?: number;
  to?: number;
  text?: string;
  children?: ParseTree[];
  // Only present after running addParentPointers
  parent?: ParseTree;
};

export type AST = [string, ...AST[]] | string;

export function addParentPointers(tree: ParseTree) {
  if (!tree.children) {
    return;
  }
  for (const child of tree.children) {
    if (child.parent) {
      // Already added parent pointers before
      return;
    }
    child.parent = tree;
    addParentPointers(child);
  }
}

export function removeParentPointers(tree: ParseTree) {
  delete tree.parent;
  if (!tree.children) {
    return;
  }
  for (const child of tree.children) {
    removeParentPointers(child);
  }
}

export function findParentMatching(
  tree: ParseTree,
  matchFn: (tree: ParseTree) => boolean,
): ParseTree | null {
  let node = tree.parent;
  while (node) {
    if (matchFn(node)) {
      return node;
    }
    node = node.parent;
  }
  return null;
}

export function collectNodesOfType(
  tree: ParseTree,
  nodeType: string,
): ParseTree[] {
  return collectNodesMatching(tree, (n) => n.type === nodeType);
}

export function collectNodesMatching(
  tree: ParseTree,
  matchFn: (tree: ParseTree) => boolean,
): ParseTree[] {
  if (matchFn(tree)) {
    return [tree];
  }
  let results: ParseTree[] = [];
  if (tree.children) {
    for (const child of tree.children) {
      results = [...results, ...collectNodesMatching(child, matchFn)];
    }
  }
  return results;
}

export async function collectNodesMatchingAsync(
  tree: ParseTree,
  matchFn: (tree: ParseTree) => Promise<boolean>,
): Promise<ParseTree[]> {
  if (await matchFn(tree)) {
    return [tree];
  }
  let results: ParseTree[] = [];
  if (tree.children) {
    for (const child of tree.children) {
      results = [
        ...results,
        ...await collectNodesMatchingAsync(child, matchFn),
      ];
    }
  }
  return results;
}

// return value: returning undefined = not matched, continue, null = delete, new node = replace
export function replaceNodesMatching(
  tree: ParseTree,
  substituteFn: (tree: ParseTree) => ParseTree | null | undefined,
) {
  if (tree.children) {
    const children = tree.children.slice();
    for (const child of children) {
      const subst = substituteFn(child);
      if (subst !== undefined) {
        const pos = tree.children.indexOf(child);
        if (subst) {
          tree.children.splice(pos, 1, subst);
        } else {
          // null = delete
          tree.children.splice(pos, 1);
        }
      } else {
        replaceNodesMatching(child, substituteFn);
      }
    }
  }
}

export async function replaceNodesMatchingAsync(
  tree: ParseTree,
  substituteFn: (tree: ParseTree) => Promise<ParseTree | null | undefined>,
) {
  if (tree.children) {
    const children = tree.children.slice();
    for (const child of children) {
      const subst = await substituteFn(child);
      if (subst !== undefined) {
        const pos = tree.children.indexOf(child);
        if (subst) {
          tree.children.splice(pos, 1, subst);
        } else {
          // null = delete
          tree.children.splice(pos, 1);
        }
      } else {
        await replaceNodesMatchingAsync(child, substituteFn);
      }
    }
  }
}

export function findNodeMatching(
  tree: ParseTree,
  matchFn: (tree: ParseTree) => boolean,
): ParseTree | null {
  return collectNodesMatching(tree, matchFn)[0];
}

export function findNodeOfType(
  tree: ParseTree,
  nodeType: string,
): ParseTree | null {
  return collectNodesMatching(tree, (n) => n.type === nodeType)[0];
}

export function traverseTree(
  tree: ParseTree,
  // Return value = should stop traversal?
  matchFn: (tree: ParseTree) => boolean,
): void {
  // Do a collect, but ignore the result
  collectNodesMatching(tree, matchFn);
}

export async function traverseTreeAsync(
  tree: ParseTree,
  // Return value = should stop traversal?
  matchFn: (tree: ParseTree) => Promise<boolean>,
): Promise<void> {
  // Do a collect, but ignore the result
  await collectNodesMatchingAsync(tree, matchFn);
}

// Finds non-text node at position
export function nodeAtPos(tree: ParseTree, pos: number): ParseTree | null {
  if (pos < tree.from! || pos >= tree.to!) {
    return null;
  }
  if (!tree.children) {
    return tree;
  }
  for (const child of tree.children) {
    const n = nodeAtPos(child, pos);
    if (n && n.text !== undefined) {
      // Got a text node, let's return its parent
      return tree;
    } else if (n) {
      // Got it
      return n;
    }
  }
  return null;
}

// Turn ParseTree back into text
export function renderToText(tree?: ParseTree): string {
  if (!tree) {
    return "";
  }
  const pieces: string[] = [];
  if (tree.text !== undefined) {
    return tree.text;
  }
  for (const child of tree.children!) {
    pieces.push(renderToText(child));
  }
  return pieces.join("");
}

export function cloneTree(tree: ParseTree): ParseTree {
  const newTree = { ...tree };
  if (tree.children) {
    newTree.children = tree.children.map(cloneTree);
  }
  delete newTree.parent;
  return newTree;
}

export function parseTreeToAST(tree: ParseTree, omitTrimmable = true): AST {
  const parseErrorNodes = collectNodesOfType(tree, "⚠");
  if (parseErrorNodes.length > 0) {
    throw new Error(
      `Parse error in: ${renderToText(tree)}`,
    );
  }
  if (tree.text !== undefined) {
    return tree.text;
  }
  const ast: AST = [tree.type!];
  for (const node of tree.children!) {
    if (node.type && !node.type.endsWith("Mark")) {
      ast.push(parseTreeToAST(node, omitTrimmable));
    }
    if (node.text && (omitTrimmable && node.text.trim() || !omitTrimmable)) {
      ast.push(node.text);
    }
  }
  return ast;
}
