import type {
  FileData,
  FileEncoding,
} from "../../common/spaces/space_primitives.ts";
import { renderToText, replaceNodesMatching } from "$sb/lib/tree.ts";
import type { FileMeta } from "../../common/types.ts";
import { parseMarkdown } from "$sb/silverbullet-syscall/markdown.ts";
import { base64EncodedDataUrl } from "../../plugos/asset_bundle/base64.ts";

const pagePrefix = "💭 ";

export async function readFileCloud(
  name: string,
  encoding: FileEncoding,
): Promise<{ data: FileData; meta: FileMeta } | undefined> {
  const originalUrl = name.substring(
    pagePrefix.length,
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
    const r = await fetch(`${url}.md`);
    text = await r.text();
    if (r.status !== 200) {
      text = `ERROR: ${text}`;
    }
  } catch (e: any) {
    console.error("ERROR", e.message);
    text = e.message;
  }
  text = await translateLinksWithPrefix(
    text,
    `${pagePrefix}${originalUrl.split("/")[0]}/`,
  );
  return {
    data: encoding === "string" ? text : base64EncodedDataUrl(
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

async function translateLinksWithPrefix(
  text: string,
  prefix: string,
): Promise<string> {
  const tree = await parseMarkdown(text);
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

export function getFileMetaCloud(name: string): Promise<FileMeta> {
  return Promise.resolve({
    name,
    size: 0,
    contentType: "text/markdown",
    lastModified: 0,
    perm: "ro",
  });
}
