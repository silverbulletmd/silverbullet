import { ParseTree, replaceNodesMatching } from "$sb/lib/tree.ts";
import { folderName, relativePath, resolve } from "../../plug-api/lib/path.ts";
import { federatedPrefix } from "../federation/translate.ts";

export function translatePageLinks(
  originPath: string,
  targetPath: string,
  tree: ParseTree,
) {
  const originFolder = folderName(originPath);
  const targetFolder = folderName(targetPath);
  replaceNodesMatching(tree, (tree) => {
    if (tree.type === "WikiLinkPage") {
      // Add the prefix in the link text
      const pageName = tree.children![0].text!;
      if (!pageName.startsWith(federatedPrefix) && !pageName.startsWith("{{")) {
        // console.log("Resolved path:", resolve(originFolder, pageName));
        // console.log("For folder", targetFolder);
        tree.children![0].text = relativePath(
          targetFolder,
          resolve(originFolder, pageName),
        );
      }
    }
    if (tree.type === "PageRef") {
      // Shape: [[pageref]] occur in queries
      // Add the prefix in the link text
      tree.children![0].text = makePageLinksRelative(
        tree.children![0].text!,
        originFolder,
        targetFolder,
      );
    }
    if (tree.type === "DirectiveStart" && tree.children![0].text) {
      // #use or #include
      tree.children![0].text = makePageLinksRelative(
        tree.children![0].text!,
        originFolder,
        targetFolder,
      );
    }

    return undefined;
  });
  return tree;
}

export function makePageLinksRelative(
  text: string,
  originFolder: string,
  targetFolder: string,
): string {
  return text.replaceAll(
    /\[\[((?!(!|https?:))[^\]]*)\]\]/g,
    (_fullMatch, pageName) => {
      // console.log("match", match, pageref);
      return `[[${
        relativePath(targetFolder, resolve(originFolder, pageName))
      }]]`;
    },
  );
}
