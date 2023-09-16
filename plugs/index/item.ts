import type { IndexTreeEvent } from "$sb/app_event.ts";

import { collectNodesOfType, ParseTree, renderToText } from "$sb/lib/tree.ts";
import { removeQueries } from "$sb/lib/query.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { rewritePageRefs } from "$sb/lib/resolve.ts";
import {
  AttributeObject,
  determineType,
  indexAttributes,
} from "./attributes.ts";
import { ObjectValue } from "$sb/types.ts";
import { indexObjects } from "./api.ts";

export type ItemObject = {
  name: string;
  page: string;
  pos: number;
  tags?: string[];
} & Record<string, any>;

export async function indexItems({ name, tree }: IndexTreeEvent) {
  const items: ObjectValue<ItemObject>[] = [];
  removeQueries(tree);

  // console.log("Indexing items", name);

  const coll = collectNodesOfType(tree, "ListItem");

  const allAttributes: AttributeObject[] = [];

  for (const n of coll) {
    if (!n.children) {
      continue;
    }
    if (collectNodesOfType(n, "Task").length > 0) {
      // This is a task item, skip it
      continue;
    }

    const item: ItemObject = {
      name: "", // to be replaced
      page: name,
      pos: n.from!,
    };

    const textNodes: ParseTree[] = [];
    let itemType: string | undefined;
    for (const child of n.children!.slice(1)) {
      rewritePageRefs(child, name);
      if (child.type === "OrderedList" || child.type === "BulletList") {
        break;
      }
      // Extract attributes and remove from tree
      const extractedAttributes = await extractAttributes(child, true);

      if (extractedAttributes.$type) {
        itemType = extractedAttributes.$type;
        delete extractedAttributes.$type;
      }

      for (const [key, value] of Object.entries(extractedAttributes)) {
        item[key] = value;
        allAttributes.push({
          name: key,
          attributeType: determineType(value),
          type: itemType || "item",
          page: name,
        });
      }
      textNodes.push(child);
    }

    item.name = textNodes.map(renderToText).join("").trim();
    collectNodesOfType(n, "Hashtag").forEach((h) => {
      if (!item.tags) {
        item.tags = [];
      }
      // Push tag to the list, removinn the initial #
      item.tags.push(h.children![0].text!.substring(1));
    });

    items.push({
      key: ["" + item.pos],
      type: itemType || "item",
      value: item,
    });
  }
  // console.log("Found", items, "item(s)");
  await indexObjects(name, items);
  // console.log("All item attributes", allAttributes);
  await indexAttributes(name, allAttributes);
}
