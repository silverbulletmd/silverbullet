import type { IndexTreeEvent } from "@silverbulletmd/web/app_event";

import {
  batchSet,
  queryPrefix,
} from "@silverbulletmd/plugos-silverbullet-syscall/index";
import {
  collectNodesMatching,
  collectNodesOfType,
  ParseTree,
  renderToText,
  replaceNodesMatching,
} from "@silverbulletmd/common/tree";
import { removeQueries } from "../query/util";
import { applyQuery, QueryProviderEvent } from "../query/engine";

export type Item = {
  name: string;
  nested?: string;
  tags?: string[];
  // Not stored in DB
  page?: string;
  pos?: number;
};

export async function indexItems({ name, tree }: IndexTreeEvent) {
  let items: { key: string; value: Item }[] = [];
  removeQueries(tree);

  console.log("Indexing items", name);

  let coll = collectNodesOfType(tree, "ListItem");

  coll.forEach((n) => {
    if (!n.children) {
      return;
    }
    if (collectNodesOfType(n, "Task").length > 0) {
      // This is a task item, skip it
      return;
    }

    let textNodes: ParseTree[] = [];
    let nested: string | undefined;
    for (let child of n.children!.slice(1)) {
      if (child.type === "OrderedList" || child.type === "BulletList") {
        nested = renderToText(child);
        break;
      }
      textNodes.push(child);
    }

    let itemText = textNodes.map(renderToText).join("").trim();
    let item: Item = {
      name: itemText,
    };
    if (nested) {
      item.nested = nested;
    }
    collectNodesOfType(n, "Hashtag").forEach((h) => {
      if (!item.tags) {
        item.tags = [];
      }
      item.tags.push(h.children![0].text!);
    });

    items.push({
      key: `it:${n.from}`,
      value: item,
    });
  });
  console.log("Found", items.length, "item(s)");
  await batchSet(name, items);
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  let allItems: Item[] = [];
  for (let { key, page, value } of await queryPrefix("it:")) {
    let [, pos] = key.split(":");
    allItems.push({
      ...value,
      page: page,
      pos: +pos,
    });
  }
  return applyQuery(query, allItems);
}
