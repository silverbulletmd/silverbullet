import { IndexEvent } from "../../webapp/app_event";
import { whiteOutQueries } from "../query/materialized_queries";

import { batchSet } from "plugos-silverbullet-syscall/index";
import { parseMarkdown } from "plugos-silverbullet-syscall/markdown";
import { collectNodesMatching, ParseTree, renderToText } from "../../common/tree";

type Item = {
  item: string;
  nested?: string;
};

export async function indexItems({ name, text }: IndexEvent) {
  let items: { key: string; value: Item }[] = [];
  text = whiteOutQueries(text);

  console.log("Indexing items", name);
  let mdTree = await parseMarkdown(text);

  let coll = collectNodesMatching(mdTree, (n) => n.type === "ListItem");

  coll.forEach((n) => {
    if (!n.children) {
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
    let item = textNodes.map(renderToText).join("").trim();
    let value: Item = {
      item,
    };
    if (nested) {
      value.nested = nested;
    }
    items.push({
      key: `it:${n.from}`,
      value,
    });
  });
  console.log("Found", items.length, "item(s)");
  await batchSet(name, items);
}
