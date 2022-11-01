import { asset, fs } from "$sb/plugos-syscall/mod.ts";
import {
  editor,
  index,
  markdown,
  space,
  system,
} from "$sb/silverbullet-syscall/mod.ts";
import { readYamlPage } from "$sb/lib/yaml_page.ts";
import { renderMarkdownToHtml } from "../markdown/markdown_render.ts";

import Handlebars from "handlebars";

import {
  collectNodesOfType,
  findNodeOfType,
  ParseTree,
  renderToText,
  replaceNodesMatching,
} from "$sb/lib/tree.ts";

type PublishConfig = {
  destDir?: string;
  title?: string;
  indexPage?: string;
  removeHashtags?: boolean;
  publishAll?: boolean;
  tags?: string[];
  prefixes?: string[];
  footerPage?: string;
};

async function generatePage(
  pageName: string,
  htmlPath: string,
  mdPath: string,
  publishedPages: string[],
  publishConfig: PublishConfig,
  destDir: string,
  footerText: string,
) {
  const pageTemplate = await asset.readAsset("assets/page.hbs");
  const pageCSS = await asset.readAsset("assets/style.css");
  const text = await space.readPage(pageName);
  const renderPage = Handlebars.compile(pageTemplate);
  console.log("Writing", pageName);
  const mdTree = await markdown.parseMarkdown(`${text}\n${footerText}`);
  const publishMd = cleanMarkdown(
    mdTree,
    publishConfig,
    publishedPages,
  );
  const attachments = await collectAttachments(mdTree);
  for (const attachment of attachments) {
    try {
      const result = await space.readAttachment(attachment);
      console.log("Writing", `${destDir}/${attachment}`);
      await fs.writeFile(`${destDir}/${attachment}`, result, "dataurl");
    } catch (e: any) {
      console.error("Error reading attachment", attachment, e.message);
    }
  }
  // Write .md file
  await fs.writeFile(mdPath, publishMd);
  // Write .html file
  await fs.writeFile(
    htmlPath,
    renderPage({
      pageName,
      config: publishConfig,
      css: pageCSS,
      body: renderMarkdownToHtml(mdTree, {
        smartHardBreak: true,
        attachmentUrlPrefix: "/",
      }),
    }),
  );
}

export async function publishAll(destDir?: string) {
  const publishConfig: PublishConfig = await readYamlPage("PUBLISH");
  destDir = destDir || publishConfig.destDir || ".";
  console.log("Publishing to", destDir);
  let allPages: any[] = await space.listPages();
  let allPageMap: Map<string, any> = new Map(
    allPages.map((pm) => [pm.name, pm]),
  );
  for (const { page, value } of await index.queryPrefix("meta:")) {
    const p = allPageMap.get(page);
    if (p) {
      for (const [k, v] of Object.entries(value)) {
        p[k] = v;
      }
    }
  }

  allPages = [...allPageMap.values()];
  let publishedPages = new Set<string>();
  if (publishConfig.publishAll) {
    publishedPages = new Set(allPages.map((p) => p.name));
  } else {
    for (const page of allPages) {
      if (publishConfig.tags && page.tags) {
        for (const tag of page.tags) {
          if (publishConfig.tags.includes(tag)) {
            publishedPages.add(page.name);
          }
        }
      }
      // Some sanity checking
      if (typeof page.name !== "string") {
        continue;
      }
      if (publishConfig.prefixes) {
        for (const prefix of publishConfig.prefixes) {
          if (page.name.startsWith(prefix)) {
            publishedPages.add(page.name);
          }
        }
      }
    }
  }
  console.log("Starting this thing", [...publishedPages]);

  let footer = "";

  if (publishConfig.footerPage) {
    footer = await space.readPage(publishConfig.footerPage);
  }

  const publishedPagesArray = [...publishedPages];
  for (const page of publishedPagesArray) {
    await generatePage(
      page,
      `${destDir}/${page.replaceAll(" ", "_")}/index.html`,
      `${destDir}/${page}.md`,
      publishedPagesArray,
      publishConfig,
      destDir,
      footer,
    );
  }

  if (publishConfig.indexPage) {
    console.log("Writing", publishConfig.indexPage);
    await generatePage(
      publishConfig.indexPage,
      `${destDir}/index.html`,
      `${destDir}/index.md`,
      publishedPagesArray,
      publishConfig,
      destDir,
      footer,
    );
  }
}

export async function publishAllCommand() {
  await editor.flashNotification("Publishing...");
  await await system.invokeFunction("server", "publishAll");
  await editor.flashNotification("Done!");
}

export function encodePageUrl(name: string): string {
  return name.replaceAll(" ", "_");
}

async function collectAttachments(tree: ParseTree) {
  const attachments: string[] = [];
  collectNodesOfType(tree, "URL").forEach((node) => {
    let url = node.children![0].text!;
    if (url.indexOf("://") === -1) {
      attachments.push(url);
    }
  });
  return attachments;
}

function cleanMarkdown(
  mdTree: ParseTree,
  publishConfig: PublishConfig,
  validPages: string[],
): string {
  replaceNodesMatching(mdTree, (n) => {
    if (n.type === "WikiLink") {
      let page = n.children![1].children![0].text!;
      if (page.includes("@")) {
        page = page.split("@")[0];
      }
      if (!validPages.includes(page)) {
        // Replace with just page text
        return {
          text: `_${page}_`,
        };
      }
    }
    // Simply get rid of these
    if (n.type === "CommentBlock" || n.type === "Comment") {
      return null;
    }
    if (n.type === "Hashtag") {
      if (publishConfig.removeHashtags) {
        return null;
      }
    }
  });
  return renderToText(mdTree).trim();
}
