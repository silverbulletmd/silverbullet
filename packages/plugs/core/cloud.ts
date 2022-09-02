import {
  renderToText,
  replaceNodesMatching,
} from "@silverbulletmd/common/tree";
import { PageMeta } from "@silverbulletmd/common/types";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";

const pagePrefix = "💭 ";

export async function readPageCloud(
  name: string
): Promise<{ text: string; meta: PageMeta } | undefined> {
  let originalUrl = name.substring(pagePrefix.length);
  let url = originalUrl;
  if (!url.includes("/")) {
    url += "/index";
  }
  if (!url.startsWith("127.0.0.1")) {
    url = `https://${url}`;
  } else {
    url = `http://${url}`;
  }
  let text = "";
  try {
    let r = await fetch(`${url}.md`);
    text = await r.text();
    if (r.status !== 200) {
      text = `ERROR: ${text}`;
    }
  } catch (e: any) {
    console.error("ERROR", e.message);
    text = e.message;
  }
  return {
    text: await translateLinksWithPrefix(
      text,
      `${pagePrefix}${originalUrl.split("/")[0]}/`
    ),
    meta: {
      name,
      lastModified: 0,
      perm: "ro",
    },
  };
}

async function translateLinksWithPrefix(
  text: string,
  prefix: string
): Promise<string> {
  let tree = await parseMarkdown(text);
  replaceNodesMatching(tree, (tree) => {
    if (tree.type === "WikiLinkPage") {
      // Add the prefix in the link text
      tree.children![0].text = prefix + tree.children![0].text;
    }
    return undefined;
  });
  text = renderToText(tree);
  return text;
}

export async function getPageMetaCloud(name: string): Promise<PageMeta> {
  return {
    name,
    lastModified: 0,
    perm: "ro",
  };
}
