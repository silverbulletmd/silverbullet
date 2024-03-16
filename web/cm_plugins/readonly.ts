import { EditorState } from "@codemirror/state";

export function readonlyMode() {
  return EditorState.changeFilter.of((tr): boolean => {
    return !tr.docChanged;
  });
}
