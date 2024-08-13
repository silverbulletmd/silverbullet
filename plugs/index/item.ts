import type { IndexTreeEvent } from "../../plug-api/types.ts";

import {
  collectNodesOfType,
  type ParseTree,
  renderToText,
} from "../../plug-api/lib/tree.ts";
import { extractAttributes } from "@silverbulletmd/silverbullet/lib/attribute";
import { rewritePageRefs } from "@silverbulletmd/silverbullet/lib/resolve";
import type { ObjectValue } from "../../plug-api/types.ts";
import { indexObjects } from "./api.ts";
import { updateITags } from "@silverbulletmd/silverbullet/lib/tags";
import { extractFrontmatter } from "@silverbulletmd/silverbullet/lib/frontmatter";

export type ItemObject = ObjectValue<
  {
    page: string;
    name: string;
    text: string;
    pos: number;
  } & Record<string, any>
>;

export async function indexItems({ name, tree }: IndexTreeEvent) {
  const items: ObjectValue<ItemObject>[] = [];

  const frontmatter = await extractFrontmatter(tree);

  const coll = collectNodesOfType(tree, "ListItem");

  for (const n of coll) {
    if (!n.children) {
      continue;
    }
    if (collectNodesOfType(n, "Task").length > 0) {
      // This is a task item, skip it
      continue;
    }

    const tags = new Set<string>();
    const item: ItemObject = {
      ref: `${name}@${n.from}`,
      tag: "item",
      name: "",
      text: "",
      page: name,
      pos: n.from!,
    };

    const textNodes: ParseTree[] = [];

    const fullText = renderToText(n);

    collectNodesOfType(n, "Hashtag").forEach((h) => {
      // Push tag to the list, removing the initial #
      tags.add(h.children![0].text!.substring(1));
      h.children = [];
    });

    // Extract attributes and remove from tree
    const extractedAttributes = await extractAttributes(
      ["item", ...tags],
      n,
      true,
    );

    for (const child of n.children!.slice(1)) {
      rewritePageRefs(child, name);
      if (child.type === "OrderedList" || child.type === "BulletList") {
        break;
      }
      textNodes.push(child);
    }

    item.name = textNodes.map(renderToText).join("").trim();
    item.text = fullText;

    if (tags.size > 0) {
      item.tags = [...tags];
    }

    for (
      const [key, value] of Object.entries(extractedAttributes)
    ) {
      item[key] = value;
    }

    updateITags(item, frontmatter);

    items.push(item);
  }
  // console.log("Found", items, "item(s)");
  await indexObjects(name, items);
}
