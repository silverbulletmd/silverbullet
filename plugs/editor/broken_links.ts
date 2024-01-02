import { traverseTree } from "../../plug-api/lib/tree.ts";
import { editor, markdown, space } from "$sb/syscalls.ts";

export async function brokenLinksCommand() {
  const pageName = "BROKEN LINKS";
  await editor.flashNotification("Scanning your space...");
  const allPages = await space.listPages();
  const allPagesMap = new Map(allPages.map((p) => [p.name, true]));
  const brokenLinks: { page: string; link: string; pos: number }[] = [];
  for (const pageMeta of allPages) {
    const text = await space.readPage(pageMeta.name);
    const tree = await markdown.parseMarkdown(text);
    traverseTree(tree, (tree) => {
      if (tree.type === "WikiLinkPage") {
        // Add the prefix in the link text
        const [pageName] = tree.children![0].text!.split(/[@$]/);
        if (pageName.startsWith("!")) {
          return true;
        }
        if (
          pageName && !pageName.startsWith("{{")
        ) {
          if (!allPagesMap.has(pageName)) {
            brokenLinks.push({
              page: pageMeta.name,
              link: pageName,
              pos: tree.from!,
            });
          }
        }
      }
      if (tree.type === "PageRef") {
        const pageName = tree.children![0].text!.slice(2, -2);
        if (pageName.startsWith("!")) {
          return true;
        }
        if (!allPagesMap.has(pageName)) {
          brokenLinks.push({
            page: pageMeta.name,
            link: pageName,
            pos: tree.from!,
          });
        }
      }

      return false;
    });
  }
  const lines: string[] = [];
  for (const brokenLink of brokenLinks) {
    lines.push(
      `* [[${brokenLink.page}@${brokenLink.pos}]]: ${brokenLink.link}`,
    );
  }
  await space.writePage(pageName, lines.join("\n"));
  await editor.navigate(pageName);
}
