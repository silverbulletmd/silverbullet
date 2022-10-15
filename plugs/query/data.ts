// Index key space:
// data:page@pos

import type { IndexTreeEvent, QueryProviderEvent } from "$sb/app_event.ts";
import { index } from "$sb/silverbullet-syscall/mod.ts";
import {
  addParentPointers,
  collectNodesOfType,
  findNodeOfType,
  ParseTree,
  replaceNodesMatching,
} from "$sb/lib/tree.ts";
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
  console.log("Found", dataObjects.length, "data objects");
  await index.batchSet(name, dataObjects);
}

export function extractMeta(
  parseTree: ParseTree,
  removeKeys: string[] = [],
): any {
  let data: any = {};
  addParentPointers(parseTree);
  replaceNodesMatching(parseTree, (t) => {
    if (t.type === "Hashtag") {
      // Check if if nested directly into a Paragraph
      if (t.parent && t.parent.type === "Paragraph") {
        const tagname = t.children![0].text;
        if (!data.tags) {
          data.tags = [];
        }
        if (!data.tags.includes(tagname)) {
          data.tags.push(tagname);
        }
      }
      return;
    }
    // Find a fenced code block
    if (t.type !== "FencedCode") {
      return;
    }
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return;
    }
    if (codeInfoNode.children![0].text !== "meta") {
      return;
    }
    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return;
    }
    const codeText = codeTextNode.children![0].text!;
    data = YAML.parse(codeText);
    if (removeKeys.length > 0) {
      const newData = { ...data };
      for (const key of removeKeys) {
        delete newData[key];
      }
      codeTextNode.children![0].text = YAML.stringify(newData).trim();
      // If nothing is left, let's just delete this thing
      if (Object.keys(newData).length === 0) {
        return null;
      }
    }
    return undefined;
  });

  return data;
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
