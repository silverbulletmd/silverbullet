import type { IndexTreeEvent } from "../../plug-api/types.ts";
import { collectNodesOfType, findNodeOfType } from "../../plug-api/lib/tree.ts";
import type { ObjectValue } from "../../plug-api/types.ts";
import { indexObjects } from "./api.ts";

export type StyleObject = ObjectValue<{
  style: string;
  origin: string;
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
    let codeOrigin = "";
    if (name.startsWith("Library/")) {
      codeOrigin = "library";
    } else {
      codeOrigin = "user";
    }

    allStyles.push({
      ref: `${name}@${t.from!}`,
      tag: "space-style",
      style: codeText,
      origin: codeOrigin,
    });
  });

  await indexObjects<StyleObject>(name, allStyles);
}
