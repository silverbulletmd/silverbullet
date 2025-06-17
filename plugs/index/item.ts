import type { IndexTreeEvent } from "../../type/event.ts";

import {
  findParentMatching,
  type ParseTree,
  renderToText,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import {
  cleanAttributes,
  extractAttributes,
} from "@silverbulletmd/silverbullet/lib/attribute";
import { rewritePageRefs } from "@silverbulletmd/silverbullet/lib/resolve";
import { indexObjects } from "./api.ts";
import {
  cleanHashTags,
  extractHashTags,
  updateITags,
} from "@silverbulletmd/silverbullet/lib/tags";
import {
  extractFrontMatter,
  type FrontMatter,
} from "@silverbulletmd/silverbullet/lib/frontmatter";
import { deepClone } from "@silverbulletmd/silverbullet/lib/json";
import type { ObjectValue } from "../../type/index.ts";

export type ItemObject = ObjectValue<
  {
    page: string;
    name: string;
    text: string;
    pos: number;
  } & Record<string, any>
>;

export async function indexItems({ name, tree }: IndexTreeEvent) {
  const items = await extractItems(name, tree);
  // console.log("Found", items, "item(s)");
  await indexObjects(name, items);
}

export async function extractItems(name: string, tree: ParseTree) {
  const items: ObjectValue<ItemObject>[] = [];

  const frontmatter = await extractFrontMatter(tree);

  await traverseTreeAsync(tree, async (n) => {
    if (n.type !== "ListItem") {
      return false;
    }

    if (!n.children) {
      // Weird, let's jump out
      return true;
    }

    // Is this a task?
    if (n.children.find((n) => n.type === "Task")) {
      // Skip tasks
      return true;
    }

    const item: ItemObject = await extractItemFromNode(
      name,
      n,
      frontmatter,
    );

    items.push(item);

    return false;
  });
  return items;
}

export async function extractItemFromNode(
  name: string,
  itemNode: ParseTree,
  frontmatter: FrontMatter,
) {
  const item: ItemObject = {
    ref: `${name}@${itemNode.from}`,
    tag: "item",
    name: "",
    text: "",
    page: name,
    pos: itemNode.from!,
  };

  // Now let's extract tags and attributes
  const tags = extractHashTags(itemNode);
  const extractedAttributes = await extractAttributes(itemNode);

  const clonedTextNodes: ParseTree[] = [];

  for (const child of itemNode.children!.slice(1)) {
    rewritePageRefs(child, name);

    if (child.type === "OrderedList" || child.type === "BulletList") {
      break;
    }
    clonedTextNodes.push(deepClone(child, ["parent"]));
  }

  // Original text
  item.text = clonedTextNodes.map(renderToText).join("").trim();

  // Clean out attribtus and tags and render a clean item name
  for (const clonedTextNode of clonedTextNodes) {
    cleanHashTags(clonedTextNode);
    cleanAttributes(clonedTextNode);
  }

  item.name = clonedTextNodes.map(renderToText).join("").trim();

  if (tags.length > 0) {
    item.tags = tags;
  }

  for (const [key, value] of Object.entries(extractedAttributes)) {
    item[key] = value;
  }

  updateITags(item, frontmatter);

  await enrichItemFromParents(itemNode, item, name, frontmatter);

  return item;
}

export async function enrichItemFromParents(
  n: ParseTree,
  item: ObjectValue<any>,
  pageName: string,
  frontmatter: FrontMatter,
) {
  let directParent = true;
  let parentItemNode = findParentMatching(n, (n) => n.type === "ListItem");
  while (parentItemNode) {
    // console.log("Got parent", parentItemNode);
    const parentItem = await extractItemFromNode(
      pageName,
      parentItemNode,
      frontmatter,
    );
    if (directParent) {
      item.parent = parentItem.ref;
      directParent = false;
    }
    // Merge tags
    item.itags = [
      ...new Set([
        ...item.itags || [],
        ...(parentItem.itags!.filter((t) => !["item", "task"].includes(t))),
      ]),
    ];

    parentItemNode = findParentMatching(
      parentItemNode,
      (n) => n.type === "ListItem",
    );
  }
}
