import {
  collectNodesMatching,
  collectNodesOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { IndexTreeEvent } from "../../type/event.ts";
import { indexObjects, queryLuaObjects } from "./api.ts";
import { getNameFromPath, parseToRef } from "../../plug-api/lib/ref.ts";
import { extractAttributes } from "@silverbulletmd/silverbullet/lib/attribute";
import { extractHashtag } from "../../plug-api/lib/tags.ts";
import { lua } from "@silverbulletmd/silverbullet/syscalls";
import type { ObjectValue } from "../../type/index.ts";
import type { CompleteEvent } from "@silverbulletmd/silverbullet/type/client";

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
      tags.add(extractHashtag(h.children![0].text!));
      h.children = [];
    });

    // Extract attributes and remove from tree
    const extractedAttributes = await extractAttributes(n);
    const name = n.children!.slice(1).map(renderToText).join("").trim();

    headers.push({
      ref: `${pageName}#${name}`,
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
  const match = /(?:\[\[|\[.*?\]\()(?<path>.*)$/.exec(
    completeEvent.linePrefix,
  );
  if (!match || !match.groups?.path) {
    return;
  }

  const ref = parseToRef(match.groups.path);
  // `parseToRef` doesn't actually return a header if the header is an empty
  // string, so we have to do the little hacky check for the`#`
  if (
    !ref ||
    ref.details?.type !== "header" && !completeEvent.linePrefix.endsWith("#")
  ) {
    return;
  }

  const headers = await queryLuaObjects<HeaderObject>(
    "header",
    {
      objectVariable: "_",
      where: await lua.parseExpression(`_.page == name`),
    },
    { name: getNameFromPath(ref.path) || completeEvent.pageName },
    5,
  );

  return {
    from: completeEvent.pos - match.groups.path.length,
    options: headers.map((header) => ({
      label: header.page === completeEvent.pageName
        ? `#${header.name}`
        : header.ref,
      type: "header",
    })),
  };
}
