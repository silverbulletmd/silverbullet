import { collectNodesMatching } from "$lib/tree.ts";
import type { CompleteEvent, IndexTreeEvent } from "$type/types.ts";
import { ObjectValue } from "$type/types.ts";
import { indexObjects, queryObjects } from "./api.ts";
import { parsePageRef } from "$sb/lib/page_ref.ts";

type HeaderObject = ObjectValue<{
  name: string;
  page: string;
  level: number;
  pos: number;
}>;

export async function indexHeaders({ name: pageName, tree }: IndexTreeEvent) {
  const headers: ObjectValue<HeaderObject>[] = [];

  collectNodesMatching(tree, (t) => !!t.type?.startsWith("ATXHeading")).forEach(
    (n) => {
      const level = +n.type!.substring("ATXHeading".length);
      const name = n.children![1].text!.trim();
      headers.push({
        ref: `${pageName}#${name}@${n.from}`,
        tag: "header",
        level,
        name,
        page: pageName,
        pos: n.from!,
      });
    },
  );
  // console.log("Found", headers.length, "headers(s)");
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
