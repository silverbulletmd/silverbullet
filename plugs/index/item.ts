import type { IndexTreeEvent } from "$sb/app_event.ts";

import { collectNodesOfType, ParseTree, renderToText } from "$sb/lib/tree.ts";
import { removeQueries } from "$sb/lib/query.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { rewritePageRefs } from "$sb/lib/resolve.ts";
import { ObjectValue } from "$sb/types.ts";
import { indexObjects } from "./api.ts";

export type ItemObject = ObjectValue<
  {
    name: string;
    page: string;
    pos: number;
  } & Record<string, any>
>;

export async function indexItems({ name, tree }: IndexTreeEvent) {
  const items: ObjectValue<ItemObject>[] = [];
  removeQueries(tree);

  // console.log("Indexing items", name);

  const coll = collectNodesOfType(tree, "ListItem");

  for (const n of coll) {
    if (!n.children) {
      continue;
    }
    if (collectNodesOfType(n, "Task").length > 0) {
      // This is a task item, skip it
      continue;
    }

    const tags = new Set<string>(["item"]);

    const item: ItemObject = {
      ref: `${name}@${n.from}`,
      tags: [],
      name: "", // to be replaced
      page: name,
      pos: n.from!,
    };

    const textNodes: ParseTree[] = [];

    collectNodesOfType(n, "Hashtag").forEach((h) => {
      // Push tag to the list, removing the initial #
      tags.add(h.children![0].text!.substring(1));
    });

    for (const child of n.children!.slice(1)) {
      rewritePageRefs(child, name);
      if (child.type === "OrderedList" || child.type === "BulletList") {
        break;
      }
      // Extract attributes and remove from tree
      const extractedAttributes = await extractAttributes(child, true);

      for (const [key, value] of Object.entries(extractedAttributes)) {
        item[key] = value;
      }
      textNodes.push(child);
    }

    item.name = textNodes.map(renderToText).join("").trim();
    item.tags = [...tags.values()];

    items.push(item);
  }
  // console.log("Found", items, "item(s)");
  await indexObjects(name, items);
}
