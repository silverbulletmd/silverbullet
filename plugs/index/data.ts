import type { IndexTreeEvent } from "../../plug-api/types.ts";
import { YAML } from "$sb/syscalls.ts";
import { collectNodesOfType, findNodeOfType } from "$sb/lib/tree.ts";
import { ObjectValue } from "../../plug-api/types.ts";
import { indexObjects } from "./api.ts";
import { TagObject } from "./tags.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { updateITags } from "$sb/lib/tags.ts";

type DataObject = ObjectValue<
  {
    pos: number;
    page: string;
  } & Record<string, any>
>;

export async function indexData({ name, tree }: IndexTreeEvent) {
  const dataObjects: ObjectValue<DataObject>[] = [];
  const frontmatter = await extractFrontmatter(tree);

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
            ref: `${name}@${pos}`,
            tag: dataType,
            ...doc,
            pos,
            page: name,
          };
          updateITags(dataObj, frontmatter);
          dataObjects.push(dataObj);
        }
        // console.log("Parsed data", parsedData);
        await indexObjects<TagObject>(name, [
          {
            ref: dataType,
            tag: "tag",
            name: dataType,
            page: name,
            parent: "data",
          },
        ]);
      } catch (e) {
        console.error("Could not parse data", codeText, "error:", e);
        return;
      }
    }),
  );
  // console.log("Found", dataObjects.length, "data objects");
  await indexObjects(name, dataObjects);
}
