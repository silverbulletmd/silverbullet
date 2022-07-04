import { collectNodesOfType } from "@silverbulletmd/common/tree";
import {
  batchSet,
  queryPrefix,
} from "@silverbulletmd/plugos-silverbullet-syscall";
import { matchBefore } from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import type { IndexTreeEvent } from "@silverbulletmd/web/app_event";
import { applyQuery, QueryProviderEvent } from "../query/engine";
import { removeQueries } from "../query/util";

// Key space
// tag:TAG => true (for completion)

export async function indexTags({ name, tree }: IndexTreeEvent) {
  removeQueries(tree);
  let allTags = new Set<string>();
  collectNodesOfType(tree, "Hashtag").forEach((n) => {
    allTags.add(n.children![0].text!);
  });
  batchSet(
    name,
    [...allTags].map((t) => ({ key: `tag:${t}`, value: t }))
  );
}

export async function tagComplete() {
  let prefix = await matchBefore("#[^#\\s]+");
  //   console.log("Running tag complete", prefix);
  if (!prefix) {
    return null;
  }
  let allTags = await queryPrefix(`tag:${prefix.text}`);
  return {
    from: prefix.from,
    options: allTags.map((tag) => ({
      label: tag.value,
      type: "tag",
    })),
  };
}

type Tag = {
  name: string;
  freq: number;
};

export async function tagProvider({ query }: QueryProviderEvent) {
  let allTags = new Map<string, number>();
  for (let { value } of await queryPrefix("tag:")) {
    let currentFreq = allTags.get(value);
    if (!currentFreq) {
      currentFreq = 0;
    }
    allTags.set(value, currentFreq + 1);
  }
  return applyQuery(
    query,
    [...allTags.entries()].map(([name, freq]) => ({
      name,
      freq,
    }))
  );
}
