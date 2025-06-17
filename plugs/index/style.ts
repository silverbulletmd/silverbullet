import type { IndexTreeEvent } from "../../type/event.ts";
import { collectNodesOfType, findNodeOfType } from "../../plug-api/lib/tree.ts";
import { indexObjects } from "./api.ts";
import type { ObjectValue } from "../../type/index.ts";

export type StyleObject = ObjectValue<{
  style: string;
  priority?: number;
}>;

export async function indexSpaceStyle({ name, tree }: IndexTreeEvent) {
  const allStyles: StyleObject[] = [];

  // Also collect CSS from custom styles in config
  collectNodesOfType(tree, "FencedCode").map((t) => {
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (!codeInfoNode) {
      return;
    }

    const fenceType = codeInfoNode.children![0].text!;
    if (fenceType !== "space-style") {
      return;
    }

    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      // Honestly, this shouldn't happen
      return;
    }
    const codeText = codeTextNode.children![0].text!;

    // Parse out /* priority: */
    const priority = codeText.match(/\/\*+\s*priority:\s*(-?\d+)/)?.[1];

    allStyles.push({
      ref: `${name}@${t.from!}`,
      tag: "space-style",
      style: codeText,
      priority: priority !== undefined ? +priority : undefined,
    });
  });

  await indexObjects<StyleObject>(name, allStyles);
}
