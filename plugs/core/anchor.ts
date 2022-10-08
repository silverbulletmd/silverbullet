import { collectNodesOfType } from "../../common/tree.ts";
import {
  batchSet,
  queryPrefix,
} from "../../syscall/silverbullet-syscall/index.ts";
import {
  getCurrentPage,
  matchBefore,
} from "../../syscall/silverbullet-syscall/editor.ts";
import type { IndexTreeEvent } from "../../web/app_event.ts";
import { removeQueries } from "../query/util.ts";

// Key space
// a:pageName:anchorName => pos

export async function indexAnchors({ name: pageName, tree }: IndexTreeEvent) {
  removeQueries(tree);
  let anchors: { key: string; value: string }[] = [];

  collectNodesOfType(tree, "NamedAnchor").forEach((n) => {
    let aName = n.children![0].text!;
    anchors.push({
      key: `a:${pageName}:${aName}`,
      value: "" + n.from,
    });
  });
  console.log("Found", anchors.length, "anchors(s)");
  await batchSet(pageName, anchors);
}

export async function anchorComplete() {
  let prefix = await matchBefore("\\[\\[[^\\]@:]*@[\\w\\.\\-\\/]*");
  if (!prefix) {
    return null;
  }
  const [pageRefPrefix, anchorRef] = prefix.text.split("@");
  let pageRef = pageRefPrefix.substring(2);
  if (!pageRef) {
    pageRef = await getCurrentPage();
  }
  let allAnchors = await queryPrefix(`a:${pageRef}:@${anchorRef}`);
  return {
    from: prefix.from + pageRefPrefix.length + 1,
    options: allAnchors.map((a) => ({
      label: a.key.split("@")[1],
      type: "anchor",
    })),
  };
}
