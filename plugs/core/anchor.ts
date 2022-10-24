import { collectNodesOfType } from "$sb/lib/tree.ts";
import { editor, index } from "$sb/silverbullet-syscall/mod.ts";
import type { IndexTreeEvent } from "$sb/app_event.ts";
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

export async function anchorComplete() {
  const prefix = await editor.matchBefore("\\[\\[[^\\]@:]*@[\\w\\.\\-\\/]*");
  if (!prefix) {
    return null;
  }
  const [pageRefPrefix, anchorRef] = prefix.text.split("@");
  let pageRef = pageRefPrefix.substring(2);
  if (!pageRef) {
    pageRef = await editor.getCurrentPage();
  }
  const allAnchors = await index.queryPrefix(
    `a:${pageRef}:${anchorRef}`,
  );
  return {
    from: prefix.from + pageRefPrefix.length + 1,
    options: allAnchors.map((a) => ({
      label: a.key.split(":")[2],
      type: "anchor",
    })),
  };
}
