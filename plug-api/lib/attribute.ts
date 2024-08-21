import {
  findNodeOfType,
  type ParseTree,
  renderToText,
  replaceNodesMatching,
  traverseTreeAsync,
} from "./tree.ts";

import { cleanupJSON } from "@silverbulletmd/silverbullet/lib/json";

import { system, YAML } from "../syscalls.ts";

/**
 * Extracts attributes from a tree
 * @param tree tree to extract attributes from
 * @returns mapping from attribute name to attribute value
 */
export async function extractAttributes(
  tags: string[],
  tree: ParseTree,
): Promise<Record<string, any>> {
  let attributes: Record<string, any> = {};
  await traverseTreeAsync(tree, async (n) => {
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
          attributes[name] = cleanupJSON(await YAML.parse(val));
        } catch (e: any) {
          console.error("Error parsing attribute value as YAML", val, e);
        }
      }
      return true;
    }
    // Go on...
    return false;
  });
  const text = renderToText(tree);
  const spaceScriptAttributes = await system.applyAttributeExtractors(
    tags,
    text,
    tree,
  );
  attributes = {
    ...attributes,
    ...spaceScriptAttributes,
  };
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
