import { ClickEvent } from "../../webapp/src/app_event.ts";
import { syscall } from "./lib/syscall.ts";

export default async function click(event: ClickEvent) {
  console.log("Event", event);
  if (event.ctrlKey || event.metaKey) {
    let syntaxNode = await syscall("editor.getSyntaxNodeAtPos", event.pos);
    console.log("Here", syntaxNode);
    if (syntaxNode && syntaxNode.name === "WikiLinkPage") {
      await syscall("editor.navigate", syntaxNode.text);
    }
  }
}
