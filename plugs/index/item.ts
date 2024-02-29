import type { IndexTreeEvent } from "../../plug-api/types.ts";

import {
  collectNodesOfType,
  ParseTree,
  renderToText,
} from "../../plug-api/lib/tree.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { rewritePageRefs } from "$sb/lib/resolve.ts";
import { ObjectValue } from "../../plug-api/types.ts";
import { indexObjects } from "./api.ts";
import { updateITags } from "$sb/lib/tags.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";

export type ItemObject = ObjectValue<
  {
    name: string;
    page: string;
    pos: number;
  } & Record<string, any>
>;

export async function indexItems({ name, tree }: IndexTreeEvent) {
  const items: ObjectValue<ItemObject>[] = [];

  const frontmatter = await extractFrontmatter(tree);

  const coll = collectNodesOfType(tree, "ListItem");

  for (let n of coll) {
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
      name: "", // to be replaced
      page: name,
      pos: n.from!,
    };

    const textNodes: ParseTree[] = [];

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
