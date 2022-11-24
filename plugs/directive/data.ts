// Index key space:
// data:page@pos

import type { IndexTreeEvent, QueryProviderEvent } from "$sb/app_event.ts";
import { index } from "$sb/silverbullet-syscall/mod.ts";
import { collectNodesOfType, findNodeOfType } from "$sb/lib/tree.ts";
import { applyQuery, removeQueries } from "$sb/lib/query.ts";
import * as YAML from "yaml";

export async function indexData({ name, tree }: IndexTreeEvent) {
  const dataObjects: { key: string; value: any }[] = [];

  removeQueries(tree);

  collectNodesOfType(tree, "FencedCode").forEach((t) => {
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return;
    }
    if (codeInfoNode.children![0].text !== "data") {
      return;
    }
    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return;
    }
    const codeText = codeTextNode.children![0].text!;
    try {
      const docs = codeText.split("---").map((d) => YAML.parse(d));
      // We support multiple YAML documents in one block
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        if (!doc) {
          continue;
        }
        dataObjects.push({
          key: `data:${name}@${i}`,
          value: doc,
        });
      }
      // console.log("Parsed data", parsedData);
    } catch (e) {
      console.error("Could not parse data", codeText, "error:", e);
      return;
    }
  });
  // console.log("Found", dataObjects.length, "data objects");
  await index.batchSet(name, dataObjects);
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  const allData: any[] = [];
  for (const { key, page, value } of await index.queryPrefix("data:")) {
    const [, pos] = key.split("@");
    allData.push({
      ...value,
      page: page,
      pos: +pos,
    });
  }
  return applyQuery(query, allData);
}
