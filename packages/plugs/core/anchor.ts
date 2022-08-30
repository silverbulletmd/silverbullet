import { collectNodesOfType, traverseTree } from "@silverbulletmd/common/tree";
import {
  batchSet,
  queryPrefix,
} from "@silverbulletmd/plugos-silverbullet-syscall";
import {
  getCurrentPage,
  matchBefore,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import type { IndexTreeEvent } from "@silverbulletmd/web/app_event";
import { applyQuery, QueryProviderEvent } from "../query/engine";
import { removeQueries } from "../query/util";

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
  let prefix = await matchBefore("\\[\\[[^\\]@]*@[\\w\\.\\-\\/]*");
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
