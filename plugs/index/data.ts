import { YAML } from "@silverbulletmd/silverbullet/syscalls";
import {
  collectNodesOfType,
  findNodeOfType,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { TagObject } from "./tags.ts";
import type { FrontMatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import { updateITags } from "@silverbulletmd/silverbullet/lib/tags";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";

type DataObject = ObjectValue<
  {
    pos: number;
    page: string;
  } & Record<string, any>
>;

export async function indexData(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  tree: ParseTree,
) {
  const dataObjects: ObjectValue<DataObject>[] = [];
  const tagObjects: Map<string, ObjectValue<TagObject>> = new Map();

  await Promise.all(
    collectNodesOfType(tree, "FencedCode").map(async (t) => {
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
        const docs = codeText.split("---");
        // We support multiple YAML documents in one block
        for (let i = 0; i < docs.length; i++) {
          const doc = await YAML.parse(docs[i]);
          if (!doc) {
            continue;
          }
          const pos = t.from! + i;
          const dataObj = {
            ref: `${pageMeta.name}@${pos}`,
            tag: dataType,
            itags: ["data"],
            ...doc,
            pos,
            page: pageMeta.name,
          };
          updateITags(dataObj, frontmatter);
          dataObjects.push(dataObj);
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
    }),
  );
  return [...dataObjects, ...tagObjects.values()];
}
