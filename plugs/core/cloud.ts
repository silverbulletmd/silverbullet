import { renderToText, replaceNodesMatching } from "$sb/lib/tree.ts";
import type { FileMeta } from "../../common/types.ts";
import { parseMarkdown } from "$sb/silverbullet-syscall/markdown.ts";
import { base64EncodedDataUrl } from "../../plugos/asset_bundle/base64.ts";

export const cloudPrefix = "💭 ";

export async function readFileCloud(
  name: string,
): Promise<{ data: string; meta: FileMeta } | undefined> {
  const originalUrl = name.substring(
    cloudPrefix.length,
    name.length - ".md".length,
  );
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
    const r = await fetch(`${encodeURI(url)}.md`);
    text = await r.text();
    if (!r.ok) {
      text = `ERROR: ${text}`;
    }
  } catch (e: any) {
    console.error("ERROR thrown", e.message);
    text = `ERROR: ${e.message}`;
  }
  text = await translateLinksWithPrefix(
    text,
    `${cloudPrefix}${originalUrl.split("/")[0]}/`,
  );
  return {
    data: base64EncodedDataUrl(
      "text/markdown",
      new TextEncoder().encode(text),
    ),
    meta: {
      name,
      contentType: "text/markdown",
      lastModified: 0,
      size: text.length,
      perm: "ro",
    },
  };
}

export function writeFileCloud(
  name: string,
): Promise<FileMeta> {
  console.log("Writing cloud file", name);
  return getFileMetaCloud(name);
}

async function translateLinksWithPrefix(
  text: string,
  prefix: string,
): Promise<string> {
  const tree = await parseMarkdown(text);
  replaceNodesMatching(tree, (tree) => {
    if (tree.type === "WikiLinkPage") {
      // Add the prefix in the link text
      if (!tree.children![0].text!.startsWith(cloudPrefix)) {
        // Only for links that aren't already cloud links
        tree.children![0].text = prefix + tree.children![0].text;
      }
    }
    return undefined;
  });
  text = renderToText(tree);
  return text;
}

export function getFileMetaCloud(name: string): Promise<FileMeta> {
  return Promise.resolve({
    name,
    size: 0,
    contentType: "text/markdown",
    lastModified: 0,
    perm: "ro",
  });
}
