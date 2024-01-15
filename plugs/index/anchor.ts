import { collectNodesOfType } from "$sb/lib/tree.ts";
import type { CompleteEvent, IndexTreeEvent } from "$sb/app_event.ts";
import { ObjectValue, QueryExpression } from "$sb/types.ts";
import { indexObjects, queryObjects } from "./api.ts";

type AnchorObject = ObjectValue<{
  name: string;
  page: string;
  pos: number;
}>;

export async function indexAnchors({ name: pageName, tree }: IndexTreeEvent) {
  const anchors: ObjectValue<AnchorObject>[] = [];

  collectNodesOfType(tree, "NamedAnchor").forEach((n) => {
    const aName = n.children![0].text!.substring(1);
    anchors.push({
      ref: `${pageName}$${aName}`,
      tag: "anchor",
      name: aName,
      page: pageName,
      pos: n.from!,
    });
  });
  // console.log("Found", anchors.length, "anchors(s)");
  await indexObjects(pageName, anchors);
}

export async function anchorComplete(completeEvent: CompleteEvent) {
  const match = /\[\[([^\]@$:]*[@$][\w\.\-\/]*)$/.exec(
    completeEvent.linePrefix,
  );
  if (!match) {
    return null;
  }

  const pageRef = match[1].split(/[@$]/)[0];
  let filter: QueryExpression | undefined = ["=", ["attr", "page"], [
    "string",
    pageRef,
  ]];
  if (!pageRef) {
    // "bare" anchor, match any page for completion purposes
    filter = undefined;
  }
  const allAnchors = await queryObjects<AnchorObject>("anchor", { filter }, 5);
  return {
    from: completeEvent.pos - match[1].length,
    options: allAnchors.map((a) => ({
      label: a.page === completeEvent.pageName ? `\$${a.name}` : a.ref,
      type: "anchor",
    })),
  };
}
