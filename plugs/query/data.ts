// Index key space:
// data:page@pos

import { IndexTreeEvent } from "../../webapp/app_event";
import { batchSet, scanPrefixGlobal } from "plugos-silverbullet-syscall";
import { collectNodesOfType, findNodeOfType, ParseTree, replaceNodesMatching } from "../../common/tree";
import { parse as parseYaml, parseAllDocuments } from "yaml";
import type { QueryProviderEvent } from "./engine";
import { applyQuery } from "./engine";
import { jsonToMDTable, removeQueries } from "./util";

export async function indexData({ name, tree }: IndexTreeEvent) {
  let dataObjects: { key: string; value: Object }[] = [];

  removeQueries(tree);

  collectNodesOfType(tree, "FencedCode").forEach((t) => {
    let codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return;
    }
    if (codeInfoNode.children![0].text !== "data") {
      return;
    }
    let codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return;
    }
    let codeText = codeTextNode.children![0].text!;
    try {
      // We support multiple YAML documents in one block
      for (let doc of parseAllDocuments(codeText)) {
        if (!doc.contents) {
          continue;
        }
        console.log(doc.contents.toJSON());
        dataObjects.push({
          key: `data:${name}@${t.from! + doc.range[0]}`,
          value: doc.contents.toJSON(),
        });
      }
      // console.log("Parsed data", parsedData);
    } catch (e) {
      console.error("Could not parse data", codeText, "error:", e);
      return;
    }
  });
  console.log("Found", dataObjects.length, "data objects");
  await batchSet(name, dataObjects);
}

export function extractMeta(parseTree: ParseTree, remove = false): any {
  let data = {};
  replaceNodesMatching(parseTree, (t) => {
    if (t.type !== "FencedCode") {
      return;
    }
    let codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return;
    }
    if (codeInfoNode.children![0].text !== "meta") {
      return;
    }
    let codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return;
    }
    let codeText = codeTextNode.children![0].text!;
    data = parseYaml(codeText);
    return remove ? null : undefined;
  });

  return data;
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<string> {
  let allData: any[] = [];
  for (let { key, page, value } of await scanPrefixGlobal("data:")) {
    let [, pos] = key.split("@");
    allData.push({
      ...value,
      page: page,
      pos: +pos,
    });
  }
  let resultData = applyQuery(query, allData);
  return jsonToMDTable(resultData);
}
