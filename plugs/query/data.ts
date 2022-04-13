// Index key space:
// data:page@pos

import { IndexEvent } from "../../webapp/app_event";
import { batchSet } from "plugos-silverbullet-syscall";
import { parseMarkdown } from "plugos-silverbullet-syscall/markdown";
import { collectNodesOfType, findNodeOfType, ParseTree, replaceNodesMatching } from "../../common/tree";
import { parse as parseYaml, parseAllDocuments } from "yaml";
import { whiteOutQueries } from "./util";

export async function indexData({ name, text }: IndexEvent) {
  let e;
  text = whiteOutQueries(text);
  // console.log("Now data indexing", name);
  let mdTree = await parseMarkdown(text);

  let dataObjects: { key: string; value: Object }[] = [];

  collectNodesOfType(mdTree, "FencedCode").forEach((t) => {
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
