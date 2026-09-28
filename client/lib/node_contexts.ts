/**
 * `onlyContexts` / `exceptContexts` filtering against the syntax nodes
 * enclosing the cursor (as produced by `Client.extractParentNodes`). Contexts
 * match by prefix, so `FencedCode` also matches `FencedCode:lua`.
 */
export type NodeContextFilter = {
  onlyContexts?: string[];
  exceptContexts?: string[];
};

export function matchesNodeContexts(
  filter: NodeContextFilter,
  parentNodes: string[],
): boolean {
  const inContext = (context: string) =>
    parentNodes.some((node) => node.startsWith(context));
  if (filter.onlyContexts && !filter.onlyContexts.some(inContext)) {
    return false;
  }
  return !filter.exceptContexts?.some(inContext);
}
