import type { IndexTreeEvent } from "$sb/app_event.ts";
import { YAML } from "$sb/syscalls.ts";
import { collectNodesOfType, findNodeOfType } from "$sb/lib/tree.ts";
import { removeQueries } from "$sb/lib/query.ts";
import { ObjectValue } from "$sb/types.ts";
import { indexObjects } from "./api.ts";
import { TagObject } from "./tags.ts";

type DataObject = {
  pos: number;
  page: string;
} & Record<string, any>;

export async function indexData({ name, tree }: IndexTreeEvent) {
  const dataObjects: ObjectValue<DataObject>[] = [];

  removeQueries(tree);

  await Promise.all(
    collectNodesOfType(tree, "FencedCode").map(async (t) => {
      const codeInfoNode = findNodeOfType(t, "CodeInfo");
      if (!codeInfoNode) {
        return;
      }
      const fenceType = codeInfoNode.children![0].text!;
      if (fenceType !== "data" && !fenceType.startsWith("data:")) {
        return;
      }
      const codeTextNode = findNodeOfType(t, "CodeText");
      if (!codeTextNode) {
        // Honestly, this shouldn't happen
        return;
      }
      const codeText = codeTextNode.children![0].text!;
      const dataType = fenceType === "data" ? "data" : fenceType.substring(5);
      try {
        const docs = codeText.split("---");
        // We support multiple YAML documents in one block
        for (let i = 0; i < docs.length; i++) {
          const doc = await YAML.parse(docs[i]);
          if (!doc) {
            continue;
          }
          const pos = t.from! + i;
          dataObjects.push({
            key: ["" + pos],
            tags: [dataType],
            value: {
              ...doc,
              pos,
              page: name,
            },
          });
        }
        // console.log("Parsed data", parsedData);
        await indexObjects<TagObject>(name, [
          {
            key: [dataType],
            tags: ["tag"],
            value: { name: dataType, page: name, context: "data" },
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
