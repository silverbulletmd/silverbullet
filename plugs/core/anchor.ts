import { collectNodesOfType } from "$sb/lib/tree.ts";
import { index } from "$sb/silverbullet-syscall/mod.ts";
import type { CompleteEvent, IndexTreeEvent } from "$sb/app_event.ts";
import { removeQueries } from "$sb/lib/query.ts";

// Key space
// a:pageName:anchorName => pos

export async function indexAnchors({ name: pageName, tree }: IndexTreeEvent) {
  removeQueries(tree);
  const anchors: { key: string; value: string }[] = [];

  collectNodesOfType(tree, "NamedAnchor").forEach((n) => {
    const aName = n.children![0].text!.substring(1);
    anchors.push({
      key: `a:${pageName}:${aName}`,
      value: "" + n.from,
    });
  });
  // console.log("Found", anchors.length, "anchors(s)");
  await index.batchSet(pageName, anchors);
}

export async function anchorComplete(completeEvent: CompleteEvent) {
  const match = /\[\[([^\]@:]*@[\w\.\-\/]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }

  let [pageRef, anchorRef] = match[1].split("@");
  if (!pageRef) {
    pageRef = completeEvent.pageName;
  }
  const allAnchors = await index.queryPrefix(
    `a:${pageRef}:${anchorRef}`,
  );
  return {
    from: completeEvent.pos - anchorRef.length,
    options: allAnchors.map((a) => ({
      label: a.key.split(":")[2],
      type: "anchor",
    })),
  };
}
