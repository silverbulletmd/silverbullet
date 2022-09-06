import type { ClickEvent } from "@silverbulletmd/web/app_event";
import {
  flashNotification,
  getCurrentPage,
  getCursor,
  getText,
  navigate as navigateTo,
  openUrl,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { nodeAtPos, ParseTree } from "@silverbulletmd/common/tree";
import { invokeCommand } from "@silverbulletmd/plugos-silverbullet-syscall/system";

// Checks if the URL contains a protocol, if so keeps it, otherwise assumes an attachment
function patchUrl(url: string): string {
  if (url.indexOf("://") === -1) {
    return `attachment/${url}`;
  }
  return url;
}

async function actionClickOrActionEnter(mdTree: ParseTree | null) {
  if (!mdTree) {
    return;
  }
  // console.log("Attempting to navigate based on syntax node", mdTree);
  switch (mdTree.type) {
    case "WikiLinkPage":
      let pageLink = mdTree.children![0].text!;
      let pos;
      if (pageLink.includes("@")) {
        [pageLink, pos] = pageLink.split("@");
        if (pos.match(/^\d+$/)) {
          pos = +pos;
        }
      }
      if (!pageLink) {
        pageLink = await getCurrentPage();
      }
      await navigateTo(pageLink, pos);
      break;
    case "URL":
    case "NakedURL":
      await openUrl(patchUrl(mdTree.children![0].text!));
      break;
    case "Link":
      const url = patchUrl(mdTree.children![4].children![0].text!);
      if (url.length <= 1) {
        return flashNotification("Empty link, ignoring", "error");
      }
      await openUrl(url);
      break;
    case "CommandLink":
      let command = mdTree
        .children![0].text!.substring(2, mdTree.children![0].text!.length - 2)
        .trim();
      console.log("Got command link", command);
      await invokeCommand(command);
      break;
  }
}

export async function linkNavigate() {
  let mdTree = await parseMarkdown(await getText());
  let newNode = nodeAtPos(mdTree, await getCursor());
  await actionClickOrActionEnter(newNode);
}

export async function clickNavigate(event: ClickEvent) {
  // Navigate by default, don't navigate when Ctrl or Cmd is held
  if (event.ctrlKey || event.metaKey) {
    return;
  }
  let mdTree = await parseMarkdown(await getText());
  let newNode = nodeAtPos(mdTree, event.pos);
  await actionClickOrActionEnter(newNode);
}

export async function navigateCommand(cmdDef: any) {
  await navigateTo(cmdDef.page);
}
