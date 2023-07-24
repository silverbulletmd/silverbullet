import {
  findNodeOfType,
  ParseTree,
  replaceNodesMatching,
} from "$sb/lib/tree.ts";

export type Attribute = {
  name: string;
  value: string;
};

const numberRegex = /^-?\d+(\.\d+)?$/;

/**
 * Extracts attributes from a tree, optionally cleaning them out of the tree.
 * @param tree tree to extract attributes from
 * @param clean whether or not to clean out the attributes from the tree
 * @returns mapping from attribute name to attribute value
 */
export function extractAttributes(
  tree: ParseTree,
  clean: boolean,
): Record<string, any> {
  const attributes: Record<string, any> = {};
  replaceNodesMatching(tree, (n) => {
    if (n.type === "ListItem") {
      // Find top-level only, no nested lists
      return n;
    }
    if (n.type === "Attribute") {
      const nameNode = findNodeOfType(n, "AttributeName");
      const valueNode = findNodeOfType(n, "AttributeValue");
      if (nameNode && valueNode) {
        let val: any = valueNode.children![0].text!;
        if (numberRegex.test(val)) {
          val = +val;
        }
        attributes[nameNode.children![0].text!] = val;
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
  return attributes;
}
