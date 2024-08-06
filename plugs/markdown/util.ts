import {
  findNodeOfType,
  renderToText,
  replaceNodesMatching,
} from "@silverbulletmd/silverbullet/lib/tree";
import { markdown } from "@silverbulletmd/silverbullet/syscalls";
import { isLocalPath } from "@silverbulletmd/silverbullet/lib/resolve";

export function encodePageUrl(name: string): string {
  return name;
}

export async function cleanMarkdown(
  text: string,
  validPages?: string[],
): Promise<string> {
  const mdTree = await markdown.parseMarkdown(text);
  replaceNodesMatching(mdTree, (n) => {
    if (n.type === "WikiLink") {
      const page = n.children![1].children![0].text!;
      if (validPages && !validPages.includes(page)) {
        return {
          // HACK
          text: `_${page}_`,
        };
      }
      return {
        // HACK
        text: `[${page}](/${encodePageUrl(page)})`,
      };
    }
    // Simply get rid of these
    if (
      n.type === "CommentBlock" ||
      n.type === "Comment" ||
      n.type === "NamedAnchor"
    ) {
      return null;
    }
    if (n.type === "Hashtag") {
      return {
        text: `__${n.children![0].text}__`,
      };
    }
    if (n.type === "URL") {
      const url = n.children![0].text!;
      if (isLocalPath(url)) {
        n.children![0].text = `fs/${url}`;
      }
      console.log("Link", url);
    }
    if (n.type === "FencedCode") {
      const codeInfoNode = findNodeOfType(n, "CodeInfo");
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
