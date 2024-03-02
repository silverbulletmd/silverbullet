import {
  collectNodesMatching,
  collectNodesOfType,
  renderToText,
} from "$sb/lib/tree.ts";
import type { CompleteEvent, IndexTreeEvent } from "../../plug-api/types.ts";
import { ObjectValue } from "../../plug-api/types.ts";
import { indexObjects, queryObjects } from "./api.ts";
import { parsePageRef } from "$sb/lib/page_ref.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";

type HeaderObject = ObjectValue<
  {
    name: string;
    page: string;
    level: number;
    pos: number;
  } & Record<string, any>
>;

export async function indexHeaders({ name: pageName, tree }: IndexTreeEvent) {
  const headers: ObjectValue<HeaderObject>[] = [];

  for (
    const n of collectNodesMatching(
      tree,
      (t) => !!t.type?.startsWith("ATXHeading"),
    )
  ) {
    const level = +n.type!.substring("ATXHeading".length);
    const tags = new Set<string>();

    collectNodesOfType(n, "Hashtag").forEach((h) => {
      // Push tag to the list, removing the initial #
      tags.add(h.children![0].text!.substring(1));
      h.children = [];
    });

    // Extract attributes and remove from tree
    const extractedAttributes = await extractAttributes(
      ["header", ...tags],
      n,
      true,
    );
    const name = n.children!.slice(1).map(renderToText).join("").trim();

    headers.push({
      ref: `${pageName}#${name}@${n.from}`,
      tag: "header",
      tags: [...tags],
      level,
      name,
      page: pageName,
      pos: n.from!,
      ...extractedAttributes,
    });
  }

  // console.log("Found", headers, "headers(s)");
  await indexObjects(pageName, headers);
}

export async function headerComplete(completeEvent: CompleteEvent) {
  const match = /\[\[([^\]$:#]*#[^\]]*)$/.exec(
    completeEvent.linePrefix,
  );
  if (!match) {
    return null;
  }

  const pageRef = parsePageRef(match[1]).page;
  const allHeaders = await queryObjects<HeaderObject>("header", {
    filter: ["=", ["attr", "page"], [
      "string",
      pageRef || completeEvent.pageName,
    ]],
  }, 5);
  return {
    from: completeEvent.pos - match[1].length,
    options: allHeaders.map((a) => ({
      label: a.page === completeEvent.pageName
        ? `#${a.name}`
        : a.ref.split("@")[0],
      type: "header",
    })),
  };
}
