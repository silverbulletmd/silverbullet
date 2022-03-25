import { ClickEvent } from "../../webapp/src/app_event";
import { syscall } from "../lib/syscall";

export async function taskToggle(event: ClickEvent) {
  let syntaxNode = await syscall("editor.getSyntaxNodeAtPos", event.pos);
  if (syntaxNode && syntaxNode.name === "TaskMarker") {
    if (syntaxNode.text === "[x]" || syntaxNode.text === "[X]") {
      await syscall("editor.dispatch", {
        changes: {
          from: syntaxNode.from,
          to: syntaxNode.to,
          insert: "[ ]",
        },
        selection: {
          anchor: event.pos,
        },
      });
    } else {
      await syscall("editor.dispatch", {
        changes: {
          from: syntaxNode.from,
          to: syntaxNode.to,
          insert: "[x]",
        },
        selection: {
          anchor: event.pos,
        },
      });
    }
  }
}
