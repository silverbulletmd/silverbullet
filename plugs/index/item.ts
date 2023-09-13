import type { IndexTreeEvent, QueryProviderEvent } from "$sb/app_event.ts";

import { index } from "$sb/syscalls.ts";
import { collectNodesOfType, ParseTree, renderToText } from "$sb/lib/tree.ts";
import { applyQuery, removeQueries } from "$sb/lib/query.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { rewritePageRefs } from "$sb/lib/resolve.ts";
import { indexAttributes } from "./attributes.ts";

export type Item = {
  name: string;
  nested?: string;
  tags?: string[];
  // Not stored in DB
  page?: string;
  pos?: number;
} & Record<string, any>;

export async function indexItems({ name, tree }: IndexTreeEvent) {
  const items: { key: string; value: Item }[] = [];
  removeQueries(tree);

  // console.log("Indexing items", name);

  const coll = collectNodesOfType(tree, "ListItem");

  const allAttributes: Record<string, any> = {};

  for (const n of coll) {
    if (!n.children) {
      continue;
    }
    if (collectNodesOfType(n, "Task").length > 0) {
      // This is a task item, skip it
      continue;
    }

    const item: Item = {
      name: "", // to be replaced
    };

    const textNodes: ParseTree[] = [];
    let nested: string | undefined;
    for (const child of n.children!.slice(1)) {
      rewritePageRefs(child, name);
      if (child.type === "OrderedList" || child.type === "BulletList") {
        nested = renderToText(child);
        break;
      }
      // Extract attributes and remove from tree
      const extractedAttributes = await extractAttributes(child, true);

      for (const [key, value] of Object.entries(extractedAttributes)) {
        item[key] = value;
        allAttributes[key] = value;
      }
      textNodes.push(child);
    }

    item.name = textNodes.map(renderToText).join("").trim();
    if (nested) {
      item.nested = nested;
    }
    collectNodesOfType(n, "Hashtag").forEach((h) => {
      if (!item.tags) {
        item.tags = [];
      }
      // Push tag to the list, removinn the initial #
      item.tags.push(h.children![0].text!.substring(1));
    });

    items.push({
      key: `it:${n.from}`,
      value: item,
    });
  }
  // console.log("Found", items, "item(s)");
  await index.batchSet(name, items);
  await indexAttributes(name, "item", allAttributes);
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  const allItems: Item[] = [];
  for (const { key, page, value } of await index.queryPrefix("it:")) {
    const [, pos] = key.split(":");
    allItems.push({
      ...value,
      page: page,
      pos: +pos,
    });
  }
  return applyQuery(query, allItems);
}
