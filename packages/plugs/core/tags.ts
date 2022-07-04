import { collectNodesOfType } from "@silverbulletmd/common/tree";
import {
  batchSet,
  queryPrefix,
} from "@silverbulletmd/plugos-silverbullet-syscall";
import { matchBefore } from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import type { IndexTreeEvent } from "@silverbulletmd/web/app_event";
import { removeQueries } from "../query/util";

// Key space
// ht:TAG => true (for completion)

export async function indexTags({ name, tree }: IndexTreeEvent) {
  removeQueries(tree);
  let allTags = new Set<string>();
  collectNodesOfType(tree, "Hashtag").forEach((n) => {
    allTags.add(n.children![0].text!);
  });
  batchSet(
    name,
    [...allTags].map((t) => ({ key: `ht:${t}`, value: t }))
  );
}

export async function tagComplete() {
  let prefix = await matchBefore("#[^#\\s]+");
  //   console.log("Running tag complete", prefix);
  if (!prefix) {
    return null;
  }
  let allTags = await queryPrefix(`ht:${prefix.text}`);
  return {
    from: prefix.from,
    options: allTags.map((tag) => ({
      label: tag.value,
      type: "tag",
    })),
  };
}
