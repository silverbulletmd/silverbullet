import { ClickEvent } from "../../webapp/app_event";
import { updateMaterializedQueriesCommand } from "./materialized_queries";
import { getCursor, getText, navigate as navigateTo, openUrl } from "plugos-silverbullet-syscall/editor";
import { taskToggleAtPos } from "../tasks/task";
import { parseMarkdown } from "plugos-silverbullet-syscall/markdown";
import { MarkdownTree, nodeAtPos } from "../lib/tree";

const materializedQueryPrefix = /<!--\s*#query\s+/;

async function actionClickOrActionEnter(mdTree: MarkdownTree | null) {
  if (!mdTree) {
    return;
  }
  console.log("Attempting to navigate based on syntax node", mdTree);
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
      await openUrl(mdTree.children![0].text!);
      break;
    case "CommentBlock":
      if (mdTree.children![0].text!.match(materializedQueryPrefix)) {
        await updateMaterializedQueriesCommand();
      }
      break;
    case "Link":
      await openUrl(mdTree.children![4].children![0].text!);
      break;
    case "TaskMarker":
      await taskToggleAtPos(mdTree.from! + 1);
      break;
  }
}

export async function linkNavigate() {
  let mdTree = await parseMarkdown(await getText());
  let newNode = nodeAtPos(mdTree, await getCursor());
  await actionClickOrActionEnter(newNode);
}

export async function clickNavigate(event: ClickEvent) {
  if (event.ctrlKey || event.metaKey) {
    let mdTree = await parseMarkdown(await getText());
    let newNode = nodeAtPos(mdTree, event.pos);
    await actionClickOrActionEnter(newNode);
  }
}
