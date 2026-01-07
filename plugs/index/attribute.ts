import {
  findNodeOfType,
  type ParseTree,
  replaceNodesMatching,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";

import { cleanupJSON } from "@silverbulletmd/silverbullet/lib/json";

import YAML from "js-yaml";

/**
 * Collects all attributes from a parse tree
 * @param tree to clean attributes from
 * @return
 */
export function collectAttributes(
  tree: ParseTree,
): Record<string, any> {
  const attributes: Record<string, any> = {};

  traverseTree(tree, (n) => {
    if (tree !== n && n.type === "ListItem") {
      // Find top-level only, no nested lists
      return true;
    }
    if (n.type === "Attribute") {
      const nameNode = findNodeOfType(n, "AttributeName");
      const valueNode = findNodeOfType(n, "AttributeValue");
      if (nameNode && valueNode) {
        const name = nameNode.children![0].text!;
        const val = valueNode.children![0].text!;
        try {
          attributes[name] = cleanupJSON(YAML.load(val));
        } catch (e: any) {
          console.error("Error parsing attribute value as YAML", val, e);
        }
      }
      return true;
    }
    return false;
  });

  return attributes;
}

/**
 * Cleans attributes from a tree (as a side effect)
 * @param tree to clean attributes from
 */
export function cleanAttributes(tree: ParseTree) {
  replaceNodesMatching(tree, (n) => {
    if (n.type === "Attribute") {
      return null;
    }
    return;
  });
}
