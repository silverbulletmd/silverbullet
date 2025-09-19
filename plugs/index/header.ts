import {
  collectNodesMatching,
  collectNodesOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";
import { indexObjects, queryLuaObjects } from "./api.ts";
import {
  getNameFromPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { extractAttributes } from "@silverbulletmd/silverbullet/lib/attribute";
import { extractHashtag } from "@silverbulletmd/silverbullet/lib/tags";
import { lua } from "@silverbulletmd/silverbullet/syscalls";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
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
      ref: `${pageName}@${n.from}`,
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
  const match = /(?:\[\[|\[.*?\]\()(?<path>[^\[]*)$/.exec(
    completeEvent.linePrefix,
  );
  if (!match || !match.groups?.path) {
    return;
  }

  const ref = parseToRef(match.groups.path);
  if (!ref || ref.details?.type !== "header") {
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
      label: `${getNameFromPath(ref.path)}#${header.name}`,
      type: "header",
    })),
  };
}
