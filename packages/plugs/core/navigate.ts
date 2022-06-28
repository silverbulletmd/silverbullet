import type { ClickEvent } from "@silverbulletmd/web/app_event";
import {
  getCursor,
  getText,
  navigate as navigateTo,
  openUrl,
} from "@silverbulletmd/plugos-silverbullet-syscall/editor";
import { parseMarkdown } from "@silverbulletmd/plugos-silverbullet-syscall/markdown";
import { nodeAtPos, ParseTree } from "@silverbulletmd/common/tree";

async function actionClickOrActionEnter(mdTree: ParseTree | null) {
  if (!mdTree) {
    return;
  }
  // console.log("Attempting to navigate based on syntax node", mdTree);
  switch (mdTree.type) {
    case "WikiLinkPage":
      let pageLink = mdTree.children![0].text!;
      let pos = "0";
      if (pageLink.includes("@")) {
        [pageLink, pos] = pageLink.split("@");
      }
      await navigateTo(pageLink, +pos);
      break;
    case "URL":
    case "NakedURL":
      await openUrl(mdTree.children![0].text!);
      break;
    case "Link":
      await openUrl(mdTree.children![4].children![0].text!);
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
