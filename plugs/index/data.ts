import YAML from "js-yaml";
import {
  collectNodesOfType,
  findNodeOfType,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { TagObject } from "./tags.ts";
import type { FrontMatter } from "./frontmatter.ts";
import { updateITags } from "./tags.ts";
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

export function indexData(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
) {
  const separator = "---";
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
      const docs = codeText.split(separator);
      let cursor = 0;
      // We support multiple YAML documents in one block
      for (let i = 0; i < docs.length; i++) {
        const docStart = codeFrom + cursor;
        const docEnd = docStart + docs[i].length;
        const doc = YAML.load(docs[i]);
        if (!doc) {
          cursor += docs[i].length;
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
          ...doc,
          page: pageMeta.name,
        };
        updateITags(dataObj, frontmatter);
        dataObjects.push(dataObj);
        cursor += docs[i].length + separator.length;
      }
      tagObjects.set(dataType, {
        ref: dataType,
        tag: "tag",
        name: dataType,
        page: pageMeta.name,
        parent: "data",
      });
    } catch (e) {
      console.error("Could not parse data", codeText, "error:", e);
      return;
    }
  });

  return Promise.resolve([...dataObjects, ...tagObjects.values()]);
}
