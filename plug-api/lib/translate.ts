import { ParseTree, replaceNodesMatching } from "$sb/lib/tree.ts";
import {
  folderName,
  toAbsolutePath,
  toRelativePath,
} from "../../plug-api/lib/path.ts";

export function translatePageLinks(
  originPath: string,
  targetPath: string,
  tree: ParseTree,
) {
  const originFolder = folderName(originPath);
  // const targetFolder = folderName(targetPath);
  replaceNodesMatching(tree, (tree) => {
    if (tree.type === "WikiLinkPage") {
      // Add the prefix in the link text
      const pageName = tree.children![0].text!;
      if (!pageName.startsWith("!") && !pageName.startsWith("{{")) {
        // console.log("Resolved path:", resolve(originFolder, pageName));
        // console.log("For folder", targetFolder);
        tree.children![0].text = toRelativePath(
          targetPath,
          toAbsolutePath(originPath, pageName),
        );
      }
    }
    if (tree.type === "PageRef") {
      // Shape: [[pageref]] occur in queries
      // Add the prefix in the link text
      tree.children![0].text = makePageLinksRelative(
        tree.children![0].text!,
        originPath,
        targetPath,
      );
    }
    if (tree.type === "DirectiveStart" && tree.children![0].text) {
      // #use or #include
      tree.children![0].text = makePageLinksRelative(
        tree.children![0].text!,
        originPath,
        targetPath,
      );
    }

    return undefined;
  });
  return tree;
}

export function makePageLinksRelative(
  text: string,
  originPath: string,
  targetPath: string,
): string {
  return text.replaceAll(
    /\[\[((?!(!|https?:))[^\]]*)\]\]/g,
    (_fullMatch, pageName) => {
      // console.log("match", match, pageref);
      return `[[${
        toRelativePath(targetPath, toAbsolutePath(originPath, pageName))
      }]]`;
    },
  );
}
