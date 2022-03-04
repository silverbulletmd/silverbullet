import { ClickEvent } from "../../webapp/src/app_event";
import { syscall } from "./lib/syscall";

async function navigate(syntaxNode: any) {
  if (!syntaxNode) {
    return;
  }
  console.log("Attempting to navigate based on syntax node", syntaxNode);
  switch (syntaxNode.name) {
    case "WikiLinkPage":
      await syscall("editor.navigate", syntaxNode.text);
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
  }
}

export async function linkNavigate() {
  navigate(await syscall("editor.getSyntaxNodeUnderCursor"));
}

export async function clickNavigate(event: ClickEvent) {
  if (event.ctrlKey || event.metaKey) {
    let syntaxNode = await syscall("editor.getSyntaxNodeAtPos", event.pos);
    navigate(syntaxNode);
  }
}

export async function pageComplete() {
  let prefix = await syscall("editor.matchBefore", "\\[\\[[\\w\\s]*");
  if (!prefix) {
    return null;
  }
  let allPages = await syscall("space.listPages");
  return {
    from: prefix.from + 2,
    options: allPages.map((pageMeta: any) => ({
      label: pageMeta.name,
      type: "page",
    })),
  };
}
