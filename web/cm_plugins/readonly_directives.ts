import { EditorState } from "../deps.ts";
import { directiveRegex } from "../../plugs/directive/directives.ts";
import type { Editor } from "../editor.tsx";

// Prevents edits inside <!-- #directive --> blocks.
// Possible performance concern: on every edit (every character typed), this pulls the whole document and applies a regex to it
export function readonlyDirectives(editor: Editor) {
  return EditorState.changeFilter.of((tr): boolean => {
    // Only act on actual edits triggered by the user (so 'changes' and 'selection' are set)
    if (tr.docChanged && tr.selection) {
      const text = tr.state.sliceDoc(0);
      const allMatches = text.matchAll(directiveRegex);
      for (const match of allMatches) {
        const [_fullMatch, startInst, _type, _args, body] = match;
        const from = match.index! + startInst.length;
        const to = match.index! + startInst.length + body.length;
        for (const sel of tr.selection.ranges) {
          if (from <= sel.from && sel.to <= to) {
            // In range: BLOCK
            editor.flashNotification(
              "Cannot edit inside directive bodies (run `Directives: Update` to update instead)",
              "error",
            );
            return false;
          }
        }
      }
    }
    return true;
  });
}
