// Third party web dependencies
import {
  autocompletion,
  closeBracketsKeymap,
  CompletionContext,
  completionKeymap,
  CompletionResult,
  drawSelection,
  dropCursor,
  EditorState,
  EditorView,
  highlightSpecialChars,
  history,
  historyKeymap,
  keymap,
  standardKeymap,
} from "../../common/deps.ts";
import { useEffect, useRef, vim } from "../deps.ts";

export function MiniEditor(
  { text, vimMode, onBlur, onEnter, completer }: {
    text: string;
    vimMode: boolean;
    onBlur: () => void;
    onEnter: (newText: string) => void;
    completer?: (
      context: CompletionContext,
    ) => Promise<CompletionResult | null>;
  },
) {
  const editorDiv = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView>();
  useEffect(() => {
    if (editorDiv.current) {
      editorViewRef.current = new EditorView({
        state: buildEditorState(),
        parent: editorDiv.current!,
      });

      console.log("Created new editor view");

      return () => {
        if (editorViewRef.current) {
          editorViewRef.current.destroy();
        }
      };
    }
  }, [editorDiv]);

  useEffect(() => {
    if (editorViewRef.current) {
      editorViewRef.current.setState(buildEditorState());
    }
  }, [text]);

  useEffect(() => {
    if (editorViewRef.current) {
      editorViewRef.current.setState(buildEditorState());
    }
  }, [vimMode]);

  return <div class="sb-mini-editor" ref={editorDiv} />;

  function buildEditorState() {
    return EditorState.create({
      doc: text,
      extensions: [
        // Enable vim mode, or not
        [...vimMode ? [vim()] : []],

        autocompletion({
          override: completer ? [completer] : [],
        }),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        keymap.of([
          {
            key: "Enter",
            run: (view) => {
              onEnter(view.state.sliceDoc());
              return true;
            },
          },
          {
            key: "Escape",
            run: () => {
              onBlur();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...standardKeymap,
          ...historyKeymap,
          ...completionKeymap,
        ]),
        EditorView.domEventHandlers({
          blur: () => {
            onBlur();
          },
        }),
      ],
    });
  }
}
