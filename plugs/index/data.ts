import YAML from "js-yaml";
import {
  collectNodesOfType,
  findNodeOfType,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { TagObject } from "./tags.ts";
import type { FrontMatter } from "./frontmatter.ts";
import { commentedRange, updateITags } from "./tags.ts";
import { stripPositionAttributes } from "./position_attributes.ts";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { isValidAnchorName } from "./anchor.ts";

type DataObject = ObjectValue<
  {
    pos: number;
    page: string;
  } & Record<string, any>
>;

export function splitYamlDocuments(
  text: string,
): { text: string; offset: number }[] {
  const docs: { text: string; offset: number }[] = [];
  let start = 0;
  for (const m of text.matchAll(/^---[ \t]*$/gm)) {
    docs.push({ text: text.slice(start, m.index), offset: start });
    start = m.index + m[0].length;
  }
  docs.push({ text: text.slice(start), offset: start });
  return docs;
}

export function indexData(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
) {
  const dataObjects: ObjectValue<DataObject>[] = [];
  const tagObjects: Map<string, ObjectValue<TagObject>> = new Map();

  collectNodesOfType(tree, "FencedCode").map((t) => {
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return;
    }
    const fenceType = codeInfoNode.children![0].text!;
    if (fenceType !== "data" && !fenceType.startsWith("#")) {
      return;
    }
    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return;
    }
    const codeText = codeTextNode.children![0].text!;
    const dataType = fenceType === "data" ? "data" : fenceType.substring(1);
    try {
      const codeFrom = codeTextNode.from!;
      // We support multiple YAML documents in one block
      for (const part of splitYamlDocuments(codeText)) {
        const docStart = codeFrom + part.offset;
        const docEnd = docStart + part.text.length;
        const doc = YAML.load(part.text);
        if (!doc) {
          continue;
        }
        // Extract $ref anchor from the YAML doc. Lint surfaces duplicate
        // names; the indexer accepts the first valid value here.
        let anchorName: string | undefined;
        if (typeof doc === "object") {
          const d = doc as Record<string, unknown>;
          if ("$ref" in d) {
            const candidate = d.$ref;
            if (typeof candidate === "string" && isValidAnchorName(candidate)) {
              anchorName = candidate;
            }
            delete d.$ref;
          }
        }
        const dataObj = {
          ref: anchorName ?? `${pageMeta.name}@${docStart}`,
          tag: dataType,
          itags: ["data"],
          pos: docStart,
          range: [docStart, docEnd] as [number, number],
          ...stripPositionAttributes(doc),
          page: pageMeta.name,
        };
        updateITags(dataObj, frontmatter);
        dataObjects.push(dataObj);
      }
      const range = commentedRange(t);
      const existing = tagObjects.get(dataType);
      if (!existing || (existing.range && !range)) {
        tagObjects.set(dataType, {
          ref: dataType,
          tag: "tag",
          name: dataType,
          page: pageMeta.name,
          parent: "data",
          ...(range ? { range } : {}),
        });
      }
    } catch (e: any) {
      console.error(
        `Could not parse data block (${fenceType}) on ${pageMeta.name}: ${e?.message ?? String(e)}`,
      );
      return;
    }
  });

  return Promise.resolve([...dataObjects, ...tagObjects.values()]);
}
