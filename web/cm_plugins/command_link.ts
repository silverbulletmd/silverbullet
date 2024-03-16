import { ClickEvent } from "../../plug-api/types.ts";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import { Client } from "../client.ts";
import {
  ButtonWidget,
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.ts";
import { commandLinkRegex } from "$common/command.ts";

/**
 * Plugin to hide path prefix when the cursor is not inside.
 */
export function cleanCommandLinkPlugin(editor: Client) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    // let parentRange: [number, number];
    syntaxTree(state).iterate({
      enter: ({ type, from, to }) => {
        if (type.name !== "CommandLink") {
          return;
        }
        if (isCursorInRange(state, [from, to])) {
          return;
        }

        const text = state.sliceDoc(from, to);
        const match = commandLinkRegex.exec(text);
        if (!match) return;
        const [_fullMatch, command, _pipePart, alias] = match;

        // Hide the whole thing
        widgets.push(
          invisibleDecoration.range(
            from,
            to,
          ),
        );

        const linkText = alias || command;
        // And replace it with a widget
        widgets.push(
          Decoration.widget({
            widget: new ButtonWidget(
              linkText,
              `Run command: ${command}`,
              "sb-command-button",
              (e) => {
                if (e.altKey) {
                  // Move cursor into the link
                  return editor.editorView.dispatch({
                    selection: { anchor: from + 2 },
                  });
                }
                // Dispatch click event to navigate there without moving the cursor
                const clickEvent: ClickEvent = {
                  page: editor.currentPage,
                  ctrlKey: e.ctrlKey,
                  metaKey: e.metaKey,
                  altKey: e.altKey,
                  pos: from,
                };
                editor.dispatchAppEvent("page:click", clickEvent).catch(
                  console.error,
                );
              },
            ),
          }).range(from),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
