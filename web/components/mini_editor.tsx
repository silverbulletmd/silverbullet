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
  { text, vimMode, onBlur, onKeyUp, onEnter, focus, completer }: {
    text: string;
    vimMode: boolean;
    onBlur: () => void;
    focus?: boolean;
    onEnter: (newText: string) => void;
    onKeyUp?: (view: EditorView, event: KeyboardEvent) => boolean;
    completer?: (
      context: CompletionContext,
    ) => Promise<CompletionResult | null>;
  },
) {
  const editorDiv = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView>();
  const callbacksRef = useRef<Record<string, Function | undefined>>();

  useEffect(() => {
    if (editorDiv.current) {
      editorViewRef.current = new EditorView({
        state: buildEditorState(),
        parent: editorDiv.current!,
      });

      console.log("Created new editor view");

      if (focus) {
        editorViewRef.current.focus();
      }

      return () => {
        if (editorViewRef.current) {
          editorViewRef.current.destroy();
        }
      };
    }
  }, [editorDiv]);

  useEffect(() => {
    callbacksRef.current = { onBlur, onEnter, onKeyUp };
  });

  useEffect(() => {
    if (editorViewRef.current) {
      editorViewRef.current.setState(buildEditorState());
    }
  }, [text, vimMode]);

  // console.log("Rendering editr");

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
              callbacksRef.current!.onEnter!(view.state.sliceDoc());
              return true;
            },
          },
          {
            key: "Escape",
            run: (view) => {
              callbacksRef.current!.onBlur!();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...standardKeymap,
          ...historyKeymap,
          ...completionKeymap,
        ]),
        EditorView.domEventHandlers({
          click: (e) => {
            e.stopPropagation();
          },
          keyup: (editorDiv, view) => {
            if (callbacksRef.current!.onKeyUp) {
              return callbacksRef.current!.onKeyUp(view, editorDiv);
            }
            return false;
          },
          blur: () => {
            callbacksRef.current!.onBlur!();
          },
        }),
      ],
    });
  }
}
