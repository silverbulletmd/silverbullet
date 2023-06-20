import { folderName, resolve } from "../../plug-api/lib/path.ts";
import { traverseTree } from "../../plug-api/lib/tree.ts";
import {
  editor,
  markdown,
  space,
} from "../../plug-api/silverbullet-syscall/mod.ts";

export async function brokenLinksCommand() {
  const pageName = "BROKEN LINKS";
  await editor.flashNotification("Scanning your space...");
  const allPages = await space.listPages();
  const allPagesMap = new Map(allPages.map((p) => [p.name, true]));
  const brokenLinks: { page: string; link: string; pos: number }[] = [];
  for (const pageMeta of allPages) {
    const text = await space.readPage(pageMeta.name);
    const tree = await markdown.parseMarkdown(text);
    const originFolder = folderName(pageMeta.name);
    traverseTree(tree, (tree) => {
      if (tree.type === "WikiLinkPage") {
        // Add the prefix in the link text
        const [pageName] = tree.children![0].text!.split("@");
        if (pageName.startsWith("💭 ")) {
          return true;
        }
        if (
          pageName && !pageName.startsWith("{{")
        ) {
          const absolutePath = pageName.startsWith("!")
            ? pageName
            : resolve(originFolder, pageName);
          if (!allPagesMap.has(absolutePath)) {
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
        if (pageName.startsWith("💭 ")) {
          return true;
        }
        const absolutePath = pageName.startsWith("!")
          ? pageName
          : resolve(originFolder, pageName);
        if (!allPagesMap.has(absolutePath)) {
          brokenLinks.push({
            page: pageMeta.name,
            link: pageName,
            pos: tree.from!,
          });
        }
      }

      if (tree.type === "DirectiveBody") {
        // Don't look inside directive bodies
        return true;
      }
      //   if (tree.type === "DirectiveStart" && tree.children![0].text) {
      //     // #use or #include
      //     tree.children![0].text = makePageLinksRelative(
      //       tree.children![0].text!,
      //       originFolder,
      //       targetFolder,
      //     );
      //   }
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
