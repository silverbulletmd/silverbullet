import type { ClickEvent } from "$sb/app_event.ts";
import { editor, markdown, system } from "$sb/silverbullet-syscall/mod.ts";
import {
  addParentPointers,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
  ParseTree,
} from "$sb/lib/tree.ts";
import { folderName, resolve } from "../../plug-api/lib/path.ts";

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
  const currentFolder = folderName(currentPage);
  switch (mdTree.type) {
    case "WikiLink": {
      let pageLink = mdTree.children![1]!.children![0].text!;
      let pos;
      if (pageLink.includes("@")) {
        [pageLink, pos] = pageLink.split("@");
        if (pos.match(/^\d+$/)) {
          pos = +pos;
        }
      }
      if (!pageLink) {
        pageLink = currentPage;
      }
      const resolvedPage = pageLink.startsWith("!")
        ? pageLink
        : resolve(currentFolder, pageLink);
      await editor.navigate(resolvedPage, pos, false, inNewWindow);
      break;
    }
    case "PageRef": {
      const bracketedPageRef = mdTree.children![0].text!;
      const currentPage = await editor.getCurrentPage();
      const currentFolder = folderName(currentPage);

      // Slicing off the initial [[ and final ]]
      const pageName = bracketedPageRef.substring(
        2,
        bracketedPageRef.length - 2,
      );
      const resolvedPage = pageName.startsWith("!") ? pageName : resolve(
        currentFolder,
        pageName,
      );
      await editor.navigate(resolvedPage, 0, false, inNewWindow);
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
      let url = urlNode.children![0].text!;
      if (url.length <= 1) {
        return editor.flashNotification("Empty link, ignoring", "error");
      }
      if (url.indexOf("://") === -1 && !url.startsWith("mailto:")) {
        url = resolve(currentFolder, decodeURI(url));
        return editor.openUrl(`/.fs/${url}`);
      } else {
        await editor.openUrl(url);
      }
      break;
    }
    case "CommandLink": {
      const commandName = mdTree.children![1]!.children![0].text!;
      await system.invokeCommand(commandName);
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
