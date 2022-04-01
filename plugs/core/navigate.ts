import { ClickEvent } from "../../webapp/app_event";
import { updateMaterializedQueriesCommand } from "./materialized_queries";
import {
  getSyntaxNodeAtPos,
  getSyntaxNodeUnderCursor,
  navigate as navigateTo,
  openUrl,
} from "plugos-silverbullet-syscall/editor";
import { taskToggleAtPos } from "../tasks/task";

const materializedQueryPrefix = /<!--\s*#query\s+/;

async function actionClickOrActionEnter(syntaxNode: any) {
  if (!syntaxNode) {
    return;
  }
  console.log("Attempting to navigate based on syntax node", syntaxNode);
  switch (syntaxNode.name) {
    case "WikiLinkPage":
      let pageLink = syntaxNode.text;
      let pos = 0;
      if (pageLink.includes("@")) {
        [pageLink, pos] = syntaxNode.text.split("@");
      }
      await navigateTo(pageLink, +pos);
      break;
    case "URL":
      await openUrl(syntaxNode.text);
      break;
    case "CommentBlock":
      if (syntaxNode.text.match(materializedQueryPrefix)) {
        await updateMaterializedQueriesCommand();
      }
      break;
    case "Link":
      // Markdown link: [bla](URLHERE) needs extraction
      let match = /\[[^\\]+\]\(([^\)]+)\)/.exec(syntaxNode.text);
      if (match) {
        await openUrl(match[1]);
      }
      break;
    case "TaskMarker":
      await taskToggleAtPos(syntaxNode.from + 1);
      break;
  }
}

export async function linkNavigate() {
  await actionClickOrActionEnter(await getSyntaxNodeUnderCursor());
}

export async function clickNavigate(event: ClickEvent) {
  if (event.ctrlKey || event.metaKey) {
    let syntaxNode = await getSyntaxNodeAtPos(event.pos);
    await actionClickOrActionEnter(syntaxNode);
  }
}
