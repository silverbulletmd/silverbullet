import { EditorState } from "../deps.ts";

export function readonlyMode() {
  return EditorState.changeFilter.of((tr): boolean => {
    return !tr.docChanged;
  });
}
