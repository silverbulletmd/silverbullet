import { Editor } from "./editor";
import { AppCommand, CommandContext } from "./types";

export function buildContext(cmd: AppCommand, editor: Editor) {
  let ctx: CommandContext = {};
  if (!cmd.command.requiredContext) {
    return ctx;
  }
  if (cmd.command.requiredContext.text) {
    ctx.text = editor.editorView?.state.sliceDoc();
  }
  return ctx;
}
