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
