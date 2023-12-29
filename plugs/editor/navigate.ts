import type { ClickEvent } from "$sb/app_event.ts";
import { editor, markdown, system } from "$sb/syscalls.ts";
import {
  addParentPointers,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
  ParseTree,
} from "$sb/lib/tree.ts";
import { resolveAttachmentPath, resolvePath } from "$sb/lib/resolve.ts";

async function actionClickOrActionEnter(
  mdTree: ParseTree | null,
  inNewWindow = false,
) {
  if (!mdTree) {
    return;
  }
  const navigationNodeFinder = (t: ParseTree) =>
    [
      "WikiLink",
      "Link",
      "Image",
      "URL",
      "NakedURL",
      "Link",
      "CommandLink",
      "PageRef",
    ]
      .includes(
        t.type!,
      );
  if (!navigationNodeFinder(mdTree)) {
    mdTree = findParentMatching(mdTree, navigationNodeFinder);
    if (!mdTree) {
      return;
    }
  }
  const currentPage = await editor.getCurrentPage();
  switch (mdTree.type) {
    case "WikiLink": {
      let pageLink = mdTree.children![1]!.children![0].text!;
      let pos: string | number = 0;
      if (pageLink.includes("@") || pageLink.includes("$")) {
        [pageLink, pos] = pageLink.split(/[@$]/);
        if (pos.match(/^\d+$/)) {
          pos = +pos;
        }
      }
      pageLink = resolvePath(currentPage, pageLink);
      if (!pageLink) {
        pageLink = currentPage;
      }
      await editor.navigate(pageLink, pos, false, inNewWindow);
      break;
    }
    case "PageRef": {
      const bracketedPageRef = mdTree.children![0].text!;

      // Slicing off the initial [[ and final ]]
      const pageName = bracketedPageRef.substring(
        2,
        bracketedPageRef.length - 2,
      );
      await editor.navigate(pageName, 0, false, inNewWindow);
      break;
    }
    case "NakedURL":
      await editor.openUrl(mdTree.children![0].text!);
      break;
    case "Image":
    case "Link": {
      const urlNode = findNodeOfType(mdTree, "URL");
      if (!urlNode) {
        return;
      }
      const url = urlNode.children![0].text!;
      if (url.length <= 1) {
        return editor.flashNotification("Empty link, ignoring", "error");
      }
      if (url.indexOf("://") === -1 && !url.startsWith("mailto:")) {
        return editor.openUrl(
          resolveAttachmentPath(currentPage, decodeURI(url)),
        );
      } else {
        await editor.openUrl(url);
      }
      break;
    }
    case "CommandLink": {
      const commandName = mdTree.children![1]!.children![0].text!;
      const argsNode = findNodeOfType(mdTree, "CommandLinkArgs");
      const argsText = argsNode?.children![0]?.text;
      // Assume the arguments are can be parsed as the innards of a valid JSON list
      try {
        const args = argsText ? JSON.parse(`[${argsText}]`) : [];
        await system.invokeCommand(commandName, args);
      } catch (e: any) {
        await editor.flashNotification(
          `Error parsing command link arguments: ${e.message}`,
          "error",
        );
      }
      break;
    }
  }
}

export async function linkNavigate() {
  const mdTree = await markdown.parseMarkdown(await editor.getText());
  const newNode = nodeAtPos(mdTree, await editor.getCursor());
  addParentPointers(mdTree);
  await actionClickOrActionEnter(newNode);
}

export async function clickNavigate(event: ClickEvent) {
  // Navigate by default, don't navigate when Alt is held
  if (event.altKey) {
    return;
  }
  const mdTree = await markdown.parseMarkdown(await editor.getText());
  addParentPointers(mdTree);
  const newNode = nodeAtPos(mdTree, event.pos);
  await actionClickOrActionEnter(newNode, event.ctrlKey || event.metaKey);
}

export async function navigateCommand(cmdDef: any) {
  await editor.navigate(cmdDef.page);
}
