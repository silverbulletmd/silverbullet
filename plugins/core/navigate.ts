import { ClickEvent } from "../../webapp/src/app_event.ts";
import { syscall } from "./lib/syscall.ts";

export async function linkNavigate() {
  let syntaxNode = await syscall("editor.getSyntaxNodeUnderCursor");
  if (syntaxNode && syntaxNode.name === "WikiLinkPage") {
    await syscall("editor.navigate", syntaxNode.text);
  }
}

export async function clickNavigate(event: ClickEvent) {
  let syntaxNode = await syscall("editor.getSyntaxNodeAtPos", event.pos);

  if (event.ctrlKey || event.metaKey) {
    console.log("Here", syntaxNode);
    if (syntaxNode && syntaxNode.name === "WikiLinkPage") {
      await syscall("editor.navigate", syntaxNode.text);
      return;
    }
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
