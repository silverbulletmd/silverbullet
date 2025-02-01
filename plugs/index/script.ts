import type { IndexTreeEvent } from "../../plug-api/types.ts";
import { collectNodesOfType, findNodeOfType } from "../../plug-api/lib/tree.ts";
import type { ObjectValue } from "../../plug-api/types.ts";
import { indexObjects } from "./api.ts";
export type ScriptObject = ObjectValue<{
  script: string;
  priority?: number;
}>;

export async function indexSpaceScript({ name, tree }: IndexTreeEvent) {
  const allScripts: ScriptObject[] = [];
  collectNodesOfType(tree, "FencedCode").map((t) => {
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return;
    }
    const fenceType = codeInfoNode.children![0].text!;
    if (fenceType !== "space-script") {
      return;
    }
    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return;
    }
    const codeText = codeTextNode.children![0].text!;
    allScripts.push({
      ref: `${name}@${t.from!}`,
      tag: "space-script",
      script: codeText,
    });
  });
  await indexObjects<ScriptObject>(name, allScripts);
}

export async function indexSpaceLua({ name, tree }: IndexTreeEvent) {
  const allScripts: ScriptObject[] = [];
  collectNodesOfType(tree, "FencedCode").map((t) => {
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return;
    }
    const fenceType = codeInfoNode.children![0].text!;
    if (fenceType !== "space-lua") {
      return;
    }
    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return;
    }
    const codeText = codeTextNode.children![0].text!;
    // Parse out "-- priority: <number>"
    const priority = codeText.match(/--\s*priority:\s*(-?\d+)/)?.[1];

    allScripts.push({
      ref: `${name}@${t.from!}`,
      tag: "space-lua",
      script: codeText,
      priority: priority !== undefined ? +priority : undefined,
    });
  });
  await indexObjects<ScriptObject>(name, allScripts);
}
