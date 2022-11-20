import type { IndexTreeEvent, QueryProviderEvent } from "$sb/app_event.ts";

import { index } from "$sb/silverbullet-syscall/mod.ts";
import { collectNodesOfType, ParseTree, renderToText } from "$sb/lib/tree.ts";
import { applyQuery, removeQueries } from "$sb/lib/query.ts";

export type Item = {
  name: string;
  nested?: string;
  tags?: string[];
  // Not stored in DB
  page?: string;
  pos?: number;
};

export async function indexItems({ name, tree }: IndexTreeEvent) {
  const items: { key: string; value: Item }[] = [];
  removeQueries(tree);

  // console.log("Indexing items", name);

  const coll = collectNodesOfType(tree, "ListItem");

  coll.forEach((n) => {
    if (!n.children) {
      return;
    }
    if (collectNodesOfType(n, "Task").length > 0) {
      // This is a task item, skip it
      return;
    }

    const textNodes: ParseTree[] = [];
    let nested: string | undefined;
    for (const child of n.children!.slice(1)) {
      if (child.type === "OrderedList" || child.type === "BulletList") {
        nested = renderToText(child);
        break;
      }
      textNodes.push(child);
    }

    const itemText = textNodes.map(renderToText).join("").trim();
    const item: Item = {
      name: itemText,
    };
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
  });
  // console.log("Found", items.length, "item(s)");
  await index.batchSet(name, items);
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
