import {
  findNodeOfType,
  renderToText,
  replaceNodesMatching,
} from "@silverbulletmd/common/tree";
import { parseMarkdown } from "@plugos/plugos-silverbullet-syscall/markdown";

export function encodePageUrl(name: string): string {
  return name.replaceAll(" ", "_");
}

export async function cleanMarkdown(text: string): Promise<string> {
  let mdTree = await parseMarkdown(text);
  replaceNodesMatching(mdTree, (n) => {
    if (n.type === "WikiLink") {
      const page = n.children![1].children![0].text!;
      return {
        // HACK
        text: `[${page}](/${encodePageUrl(page)})`,
      };
    }
    // Simply get rid of these
    if (n.type === "CommentBlock" || n.type === "Comment") {
      return null;
    }
    if (n.type === "FencedCode") {
      let codeInfoNode = findNodeOfType(n, "CodeInfo");
      if (!codeInfoNode) {
        return;
      }
      if (codeInfoNode.children![0].text === "meta") {
        return null;
      }
    }
  });
  return renderToText(mdTree);
}
