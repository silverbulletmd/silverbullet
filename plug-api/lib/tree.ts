export type ParseTree = {
  type?: string; // undefined === text node
  from?: number;
  to?: number;
  text?: string;
  children?: ParseTree[];
  // Only present after running addParentPointers
  parent?: ParseTree;
};

export function addParentPointers(tree: ParseTree) {
  if (!tree.children) {
    return;
  }
  for (const child of tree.children) {
    child.parent = tree;
    addParentPointers(child);
  }
}

export function removeParentPointers(tree: ParseTree) {
  tree.parent = undefined;
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

function collectNodesMatchingInternal(
  tree: ParseTree,
  matchFn: (tree: ParseTree) => boolean,
  results: ParseTree[],
): void {
  if (matchFn(tree)) {
    results.push(tree);
    return;
  }
  if (tree.children) {
    for (const child of tree.children) {
      collectNodesMatchingInternal(child, matchFn, results);
    }
  }
}

export function collectNodesMatching(
  tree: ParseTree,
  matchFn: (tree: ParseTree) => boolean,
): ParseTree[] {
  const results: ParseTree[] = [];
  collectNodesMatchingInternal(tree, matchFn, results);
  return results;
}

async function collectNodesMatchingAsyncInternal(
  tree: ParseTree,
  matchFn: (tree: ParseTree) => Promise<boolean>,
  results: ParseTree[],
): Promise<void> {
  if (await matchFn(tree)) {
    results.push(tree);
    return;
  }
  if (tree.children) {
    for (const child of tree.children) {
      await collectNodesMatchingAsyncInternal(child, matchFn, results);
    }
  }
}

export async function collectNodesMatchingAsync(
  tree: ParseTree,
  matchFn: (tree: ParseTree) => Promise<boolean>,
): Promise<ParseTree[]> {
  const results: ParseTree[] = [];
  await collectNodesMatchingAsyncInternal(tree, matchFn, results);
  return results;
}

// return value: returning undefined = not matched, continue, null = delete, new node = replace
export function replaceNodesMatching(
  tree: ParseTree,
  substituteFn: (tree: ParseTree) => ParseTree | null | undefined,
) {
  if (tree?.children) {
    let i = 0;
    while (i < tree.children.length) {
      const child = tree.children[i];
      const subst = substituteFn(child);
      if (subst !== undefined) {
        if (subst) {
          tree.children[i] = subst;
          i++;
        } else {
          // null = delete
          tree.children.splice(i, 1);
          // don't increment i — next child shifted into this position
        }
      } else {
        replaceNodesMatching(child, substituteFn);
        i++;
      }
    }
  }
}

export async function replaceNodesMatchingAsync(
  tree: ParseTree,
  substituteFn: (tree: ParseTree) => Promise<ParseTree | null | undefined>,
) {
  if (tree.children) {
    let i = 0;
    while (i < tree.children.length) {
      const child = tree.children[i];
      const subst = await substituteFn(child);
      if (subst !== undefined) {
        if (subst) {
          tree.children[i] = subst;
          i++;
        } else {
          // null = delete
          tree.children.splice(i, 1);
        }
      } else {
        await replaceNodesMatchingAsync(child, substituteFn);
        i++;
      }
    }
  }
}

export function findNodeMatching(
  tree: ParseTree,
  matchFn: (tree: ParseTree) => boolean,
): ParseTree | null {
  if (matchFn(tree)) {
    return tree;
  }
  if (tree.children) {
    for (const child of tree.children) {
      const result = findNodeMatching(child, matchFn);
      if (result) {
        return result;
      }
    }
  }
  return null;
}

export function findNodeOfType(
  tree: ParseTree,
  nodeType: string,
): ParseTree | null {
  if (tree.type === nodeType) {
    return tree;
  }
  if (tree.children) {
    for (const child of tree.children) {
      const result = findNodeOfType(child, nodeType);
      if (result) {
        return result;
      }
    }
  }
  return null;
}

export function traverseTree(
  tree: ParseTree,
  // Return value = should stop traversal into children?
  matchFn: (tree: ParseTree) => boolean,
  // Just log errors on exceptions, but don't stop traversal
  catchVisitorErrors = false,
): void {
  let stop = false;
  if (catchVisitorErrors) {
    try {
      stop = matchFn(tree);
    } catch (e: any) {
      console.warn(
        `traverseTree visitor failed at node ${tree.type}@${tree.from}:`,
        e?.stack ?? e,
      );
      return;
    }
  } else {
    stop = matchFn(tree);
  }
  if (stop) {
    return;
  }
  if (tree.children) {
    for (const child of tree.children) {
      traverseTree(child, matchFn, catchVisitorErrors);
    }
  }
}

export async function traverseTreeAsync(
  tree: ParseTree,
  // Return value = should stop traversal into children?
  matchFn: (tree: ParseTree) => Promise<boolean>,
  catchVisitorErrors = false,
): Promise<void> {
  let stop = false;
  if (catchVisitorErrors) {
    try {
      stop = await matchFn(tree);
    } catch (e: any) {
      console.error(
        `traverseTreeAsync visitor failed at node ${tree.type}@${tree.from}:`,
        e?.stack ?? e,
      );
      return;
    }
  } else {
    stop = await matchFn(tree);
  }
  if (stop) {
    return;
  }
  if (tree.children) {
    for (const child of tree.children) {
      await traverseTreeAsync(child, matchFn, catchVisitorErrors);
    }
  }
}

export function cloneTree(tree: ParseTree): ParseTree {
  if (tree.text !== undefined) {
    return {
      from: tree.from,
      to: tree.to,
      text: tree.text,
    };
  }
  const clone: ParseTree = {
    type: tree.type,
    from: tree.from,
    to: tree.to,
  };
  if (tree.children) {
    clone.children = new Array(tree.children.length);
    for (let i = 0; i < tree.children.length; i++) {
      clone.children[i] = cloneTree(tree.children[i]);
    }
  }
  return clone;
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
    }
    if (n) {
      // Got it
      return n;
    }
  }
  return null;
}

// Ensure a TableRow/TableHeader has a TableCell between every pair of
// TableDelimiters, and optionally pad to match columnCount.
// headerHasLeadingDelim indicates whether the header starts with a delimiter.
export function normalizeTableRow(
  row: ParseTree,
  columnCount?: number,
  headerHasLeadingDelim?: boolean,
): void {
  const children = row.children;
  if (!children) return;
  const normalized: ParseTree[] = [];
  let lookingForCell = false;
  for (const child of children) {
    if (child.type === "TableDelimiter" && lookingForCell) {
      normalized.push({ type: "TableCell", children: [] });
    }
    if (child.type === "TableDelimiter") {
      lookingForCell = true;
    }
    if (child.type === "TableCell") {
      lookingForCell = false;
    }
    normalized.push(child);
  }
  row.children = normalized;

  // Fix leading-pipe mismatch: row has leading delimiter but header doesn't
  if (headerHasLeadingDelim === false) {
    if (row.children.length > 0 && row.children[0].type === "TableDelimiter") {
      // Insert empty cell after the leading delimiter
      row.children.splice(1, 0, { type: "TableCell", children: [] });
    }
  }

  // Pad trailing empty cells to match header column count
  if (columnCount !== undefined) {
    let cellCount = 0;
    for (const child of row.children) {
      if (child.type === "TableCell") cellCount++;
    }
    while (cellCount < columnCount) {
      row.children.push({ type: "TableCell", children: [] });
      cellCount++;
    }
  }
}

// Turn ParseTree back into text
export function renderToText(tree?: ParseTree): string {
  if (!tree) {
    return "";
  }
  if (tree.text !== undefined) {
    return tree.text;
  }
  const children = tree.children!;
  if (children.length === 1) {
    return renderToText(children[0]);
  }
  let result = "";
  for (const child of children) {
    result += renderToText(child);
  }
  return result;
}

export function cleanTree(tree: ParseTree, omitTrimmable = true): ParseTree {
  if (tree.type === "⚠") {
    throw new Error(`Parse error at pos ${tree.from}`);
  }
  if (tree.text !== undefined) {
    return tree;
  }
  const ast: ParseTree = {
    type: tree.type,
    children: [],
    from: tree.from,
    to: tree.to,
  };
  for (const node of tree.children!) {
    if (node.type && node.type !== "Comment") {
      ast.children!.push(cleanTree(node, omitTrimmable));
    }
    if (node.text && ((omitTrimmable && node.text.trim()) || !omitTrimmable)) {
      ast.children!.push(node);
    }
  }
  return ast;
}
