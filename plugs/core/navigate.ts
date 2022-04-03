import {ClickEvent} from "../../webapp/app_event";
import {updateMaterializedQueriesCommand} from "./materialized_queries";
import {
    getSyntaxNodeAtPos,
    getSyntaxNodeUnderCursor,
    getText,
    navigate as navigateTo,
    openUrl,
} from "plugos-silverbullet-syscall/editor";
import {taskToggleAtPos} from "../tasks/task";
import {nodeAtPos, parse} from "plugos-silverbullet-syscall/markdown";

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
    let mdTree = await parse(await getText());
    let newNode = await nodeAtPos(mdTree, event.pos);
    console.log("New node", newNode);
    await actionClickOrActionEnter(syntaxNode);
  }
}
