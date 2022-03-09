import { EditorView } from "@codemirror/view";
import * as util from "../util";

export function StatusBar({ editorView }: { editorView?: EditorView }) {
  let wordCount = 0,
    readingTime = 0;
  if (editorView) {
    let text = editorView.state.sliceDoc();
    wordCount = util.countWords(text);
    readingTime = util.readingTime(wordCount);
  }
  return (
    <div id="bottom">
      {wordCount} words | {readingTime} min
    </div>
  );
}
