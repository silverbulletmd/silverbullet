import { toAbsolutePath, toRelativePath } from "$sb/lib/path.ts";
import { renderToText, traverseTree } from "$sb/lib/tree.ts";
import { editor, markdown, space } from "$sb/silverbullet-syscall/mod.ts";

export async function migrateToRelativeLinksCommand() {
  if (
    !(await editor.confirm(
      "We're going to migrate all your existing page links from the old 'absolute' link format to relative link. Depending on the size of your space, this may take some time.",
    ))
  ) {
    return;
  }

  if (
    !(await editor.confirm(
      "Since this is a somewhat risky operation, please MAKE A BACKUP before continuing",
    ))
  ) {
    return;
  }
  const allPages = await space.listPages();
  const allPagesSet = new Set(allPages.map((p) => p.name));
  const allAttachments = await space.listAttachments();
  const allAttachmentsSet = new Set(allAttachments.map((a) => a.name));
  for (const pageMeta of allPages) {
    if (pageMeta.name.startsWith("!")) {
      continue;
    }
    console.log("Now processing", pageMeta.name);
    const currentPage = pageMeta.name;
    const text = await space.readPage(currentPage);
    const tree = await markdown.parseMarkdown(text);
    traverseTree(tree, (tree) => {
      if (tree.type === "WikiLinkPage") {
        // Add the prefix in the link text
        const pathPieces = tree.children![0].text!.split("@");
        const pageName = pathPieces[0];
        const updatedLink = updateLink(allPagesSet, currentPage, pageName);
        if (updatedLink) { // Updated
          pathPieces[0] = updatedLink;
          tree.children![0].text = pathPieces.join("@");
          console.log("Updated link to", pageName);
          return true;
        }
      }
      if (tree.type === "PageRef") {
        const pageName = tree.children![0].text!.slice(2, -2);
        const updatedLink = updateLink(allPagesSet, currentPage, pageName);
        if (updatedLink) {
          tree.children![0].text = `[[${updatedLink}]]`;
          return true;
        }
      }

      if (tree.type === "URL") {
        const url = decodeURI(tree.children![0].text!);
        if (url.indexOf("://") !== -1) {
          return true;
        }
        const updatedLink = updateLink(allAttachmentsSet, currentPage, url);
        if (updatedLink) {
          tree.children![0].text = encodeURI(updatedLink);
          return true;
        }
      }

      if (tree.type === "DirectiveStart" && tree.children![0].text) {
        // #use or #include [[page/ref]]
        const pageRefMatch = /\[\[([^\]]+)\]\]/.exec(tree.children![0].text);
        if (pageRefMatch) {
          const updatedLink = updateLink(
            allPagesSet,
            currentPage,
            pageRefMatch[1],
          );
          if (updatedLink) {
            tree.children![0].text = tree.children![0].text.replace(
              pageRefMatch[0],
              `[[${updatedLink}]]`,
            );
          }
        }
      }
      return false;
    });
    const newText = renderToText(tree);
    if (text !== newText) {
      console.log("Writing", pageMeta.name);
      await space.writePage(pageMeta.name, newText);
    }
  }

  await editor.flashNotification("All done!");
}

function updateLink(
  existing: Set<string>,
  currentPage: string,
  name: string,
): string | undefined {
  // Skipping over cloud federation, template links
  if (
    !name || name.startsWith("💭 ") || name.startsWith("!") ||
    name.startsWith("{{")
  ) {
    return;
  }
  const resolvedRelativePath = toAbsolutePath(currentPage, name);
  if (existing.has(resolvedRelativePath)) {
    // Link is already correct (it resolves to an existing page)
    return;
  }
  if (existing.has(name)) {
    // Link is an absolute path, but it resolves to an existing page, so let's convert it to be relative
    const relativePath = toRelativePath(currentPage, name);
    console.log("Updating link", name, "to", relativePath);
    return relativePath;
  }

  console.warn("Not found", name, "— not updating link");
}
