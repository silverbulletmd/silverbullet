import {
  findNodeOfType,
  ParseTree,
  renderToText,
  replaceNodesMatchingAsync,
} from "$lib/tree.ts";

import { markdown, system, YAML } from "$sb/syscalls.ts";

/**
 * Extracts attributes from a tree, optionally cleaning them out of the tree.
 * @param tree tree to extract attributes from
 * @param clean whether or not to clean out the attributes from the tree
 * @returns mapping from attribute name to attribute value
 */
export async function extractAttributes(
  tags: string[],
  tree: ParseTree,
  clean: boolean,
): Promise<{ attributes: Record<string, any>; tree: ParseTree }> {
  let attributes: Record<string, any> = {};
  await replaceNodesMatchingAsync(tree, async (n) => {
    if (n.type === "ListItem") {
      // Find top-level only, no nested lists
      return n;
    }
    if (n.type === "Attribute") {
      const nameNode = findNodeOfType(n, "AttributeName");
      const valueNode = findNodeOfType(n, "AttributeValue");
      if (nameNode && valueNode) {
        const name = nameNode.children![0].text!;
        const val = valueNode.children![0].text!;
        try {
          attributes[name] = await YAML.parse(val);
        } catch (e: any) {
          console.error("Error parsing attribute value as YAML", val, e);
        }
      }
      // Remove from tree
      if (clean) {
        return null;
      } else {
        return n;
      }
    }
    // Go on...
    return undefined;
  });
  const text = renderToText(tree);
  const spaceScriptAttributeResult = await system.applyAttributeExtractors(
    tags,
    text,
    tree,
  );
  attributes = {
    ...attributes,
    ...spaceScriptAttributeResult.attributes,
  };
  if (spaceScriptAttributeResult.text) {
    // Changed text, re-parse
    tree = await markdown.parseMarkdown(spaceScriptAttributeResult.text);
  } else if (spaceScriptAttributeResult.tree) {
    // Changed parse tree
    tree = spaceScriptAttributeResult.tree;
  }
  return { attributes, tree };
}
