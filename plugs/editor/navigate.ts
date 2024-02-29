import type { ClickEvent } from "../../plug-api/types.ts";
import { editor, markdown, system } from "$sb/syscalls.ts";
import {
  addParentPointers,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
  ParseTree,
} from "$sb/lib/tree.ts";
import { resolveAttachmentPath, resolvePath } from "$sb/lib/resolve.ts";
import { parsePageRef } from "$sb/lib/page_ref.ts";
import { tagPrefix } from "../index/constants.ts";

async function actionClickOrActionEnter(
  mdTree: ParseTree | null,
  inNewWindow = false,
) {
  if (!mdTree) {
    return;
  }
  // console.log("Got a click on", mdTree);
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
      "Hashtag",
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
      const pageLink = mdTree.children![1]!.children![0].text!;
      const pageRef = parsePageRef(pageLink);
      pageRef.page = resolvePath(currentPage, pageRef.page);
      if (!pageRef.page) {
        pageRef.page = currentPage;
      }
      // This is an explicit navigate, move to the top
      if (pageRef.pos === undefined) {
        pageRef.pos = 0;
      }
      await editor.navigate(pageRef, false, inNewWindow);
      break;
    }
    case "PageRef": {
      const pageName = parsePageRef(mdTree.children![0].text!).page;
      await editor.navigate({ page: pageName, pos: 0 }, false, inNewWindow);
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
    case "Hashtag": {
      const hashtag = mdTree.children![0].text!.slice(1);
      await editor.navigate(
        { page: `${tagPrefix}${hashtag}`, pos: 0 },
        false,
        inNewWindow,
      );
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
  await editor.navigate({ page: cmdDef.page, pos: 0 });
}

export async function navigateToPage(_cmdDef: any, pageName: string) {
  await editor.navigate({ page: pageName, pos: 0 });
}

export async function navigateToURL(_cmdDef: any, url: string) {
  await editor.openUrl(url, false);
}

export async function navigateBack() {
  await editor.goHistory(-1);
}

export async function navigateForward() {
  await editor.goHistory(1);
}
