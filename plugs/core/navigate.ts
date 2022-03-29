import { ClickEvent } from "../../webapp/app_event";
import { syscall } from "../lib/syscall";

async function navigate(syntaxNode: any) {
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
      await syscall("editor.navigate", pageLink, +pos);
      break;
    case "URL":
      await syscall("editor.openUrl", syntaxNode.text);
      break;
    case "Link":
      // Markdown link: [bla](URLHERE) needs extraction
      let match = /\[[^\\]+\]\(([^\)]+)\)/.exec(syntaxNode.text);
      if (match) {
        await syscall("editor.openUrl", match[1]);
      }
      break;
  }
}

export async function linkNavigate() {
  await navigate(await syscall("editor.getSyntaxNodeUnderCursor"));
}

export async function clickNavigate(event: ClickEvent) {
  if (event.ctrlKey || event.metaKey) {
    let syntaxNode = await syscall("editor.getSyntaxNodeAtPos", event.pos);
    await navigate(syntaxNode);
  }
}
