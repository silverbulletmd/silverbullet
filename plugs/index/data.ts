import YAML from "js-yaml";
import {
  collectNodesOfType,
  findNodeOfType,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { TagObject } from "./tags.ts";
import type { FrontMatter } from "./frontmatter.ts";
import { commentedRange, normalizeTagList, updateITags } from "./tags.ts";
import { isReservedObjectAttribute } from "./position_attributes.ts";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import {
  dataBlockTag,
  dataObjectRef,
  splitYamlDocuments,
} from "./data_block.ts";

export { shadowsBuiltinTag, splitYamlDocuments } from "./data_block.ts";

type DataObject = ObjectValue<
  {
    pos: number;
    page: string;
  } & Record<string, any>
>;

export type DataBlock = {
  fence: ParseTree;
  info: ParseTree;
  code?: ParseTree;
  /** "data" for a ```data block, otherwise the tag after the # */
  tag: string;
};

/** The fence as a data block, if it is a ```data or ```#tag one */
export function asDataBlock(fence: ParseTree): DataBlock | undefined {
  const info = findNodeOfType(fence, "CodeInfo");
  if (!info) return undefined;
  const tag = dataBlockTag(info.children![0].text!);
  if (!tag) return undefined;
  return {
    fence,
    info,
    code: findNodeOfType(fence, "CodeText") ?? undefined,
    tag,
  };
}

/** The ```data and ```#tag fenced blocks in a page. */
export function dataBlocks(tree: ParseTree): DataBlock[] {
  return collectNodesOfType(tree, "FencedCode").flatMap((fence) => {
    const block = asDataBlock(fence);
    return block ? [block] : [];
  });
}

/** The range and ref of each YAML document in a data block, as indexData assigns them */
export function dataDocuments(
  pageName: string,
  block: DataBlock,
): { from: number; to: number; ref: string }[] {
  if (!block.code) return [];
  const codeFrom = block.code.from!;
  return splitYamlDocuments(block.code.children![0].text!).map((part) => {
    const from = codeFrom + part.offset;
    let doc: unknown;
    try {
      doc = YAML.load(part.text);
    } catch {
      doc = undefined;
    }
    return {
      from,
      to: from + part.text.length,
      ref: dataObjectRef(pageName, from, doc),
    };
  });
}

export function indexData(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
) {
  const dataObjects: ObjectValue<DataObject>[] = [];
  const tagObjects: Map<string, ObjectValue<TagObject>> = new Map();

  dataBlocks(tree).map(
    ({ fence: t, info, code: codeTextNode, tag: dataType }) => {
      const fenceType = info.children![0].text!;
      if (!codeTextNode) {
        // Honestly, this shouldn't happen
        return;
      }
      const codeText = codeTextNode.children![0].text!;
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
          // Lint surfaces duplicate $ref names; the indexer accepts the first valid value here.
          const ref = dataObjectRef(pageMeta.name, docStart, doc);
          if (typeof doc === "object")
            delete (doc as Record<string, unknown>).$ref;
          const fields =
            typeof doc === "object" && !Array.isArray(doc)
              ? (doc as Record<string, unknown>)
              : {};
          const attributes: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(fields)) {
            if (!isReservedObjectAttribute(key)) attributes[key] = value;
          }
          const tags = normalizeTagList(fields.tags);
          const dataObj: DataObject = {
            ref,
            tag: dataType,
            ...(tags.length ? { tags } : {}),
            itags: ["data"],
            pos: docStart,
            range: [docStart, docEnd] as [number, number],
            ...attributes,
            page: pageMeta.name,
          };
          updateITags(dataObj, frontmatter);
          dataObjects.push(dataObj);
        }
        // A ```data block uses the built-in root tag; only ```#name defines one
        if (dataType === "data") return;
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
    },
  );

  return Promise.resolve([...dataObjects, ...tagObjects.values()]);
}
