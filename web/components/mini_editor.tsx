import {
  autocompletion,
  closeBracketsKeymap,
  CompletionContext,
  completionKeymap,
  CompletionResult,
  drawSelection,
  EditorState,
  EditorView,
  highlightSpecialChars,
  history,
  historyKeymap,
  keymap,
  placeholder,
  standardKeymap,
  ViewPlugin,
  ViewUpdate,
} from "../../common/deps.ts";
import { useEffect, useRef, Vim, vim, vimGetCm } from "../deps.ts";

export function MiniEditor(
  {
    text,
    placeholderText,
    vimMode,
    vimStartInInsertMode,
    onBlur,
    resetOnBlur,
    onKeyUp,
    onEnter,
    onChange,
    focus,
    completer,
  }: {
    text: string;
    placeholderText?: string;
    vimMode: boolean;
    vimStartInInsertMode?: boolean;
    onBlur?: () => void;
    resetOnBlur?: boolean;
    focus?: boolean;
    onEnter: (newText: string) => void;
    onChange?: (newText: string) => void;
    onKeyUp?: (view: EditorView, event: KeyboardEvent) => boolean;
    completer?: (
      context: CompletionContext,
    ) => Promise<CompletionResult | null>;
  },
) {
  const editorDiv = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView>();
  const vimModeRef = useRef<string>("normal");
  // TODO: This super duper ugly, but I don't know how to avoid it
  // Due to how MiniCodeEditor is built, it captures the closures of all callback functions
  // which results in them pointing to old state variables, to avoid this we do this...
  // deno-lint-ignore ban-types
  const callbacksRef = useRef<Record<string, Function | undefined>>();

  useEffect(() => {
    if (editorDiv.current) {
      const editorView = new EditorView({
        state: buildEditorState(),
        parent: editorDiv.current!,
      });
      editorViewRef.current = editorView;

      if (focus) {
        editorView.focus();
      }

      if (vimMode && vimStartInInsertMode) {
        setTimeout(() => {
          console.log("Igniting insert mode");
          const cm = vimGetCm(editorViewRef.current!)!;
          cm.on("vim-mode-change", ({ mode }: { mode: string }) => {
            console.log("New mode", mode);
            vimModeRef.current = mode;
          });
          Vim.handleKey(cm, "i");
        });
      } else if (vimMode) {
        setTimeout(() => {
          const cm = vimGetCm(editorViewRef.current!)!;
          cm.on("vim-mode-change", ({ mode }: { mode: string }) => {
            console.log("New mode", mode);
            vimModeRef.current = mode;
          });
        });
      }

      return () => {
        if (editorViewRef.current) {
          editorViewRef.current.destroy();
        }
      };
    }
  }, [editorDiv]);

  useEffect(() => {
    callbacksRef.current = { onBlur, onEnter, onKeyUp, onChange };
  });

  useEffect(() => {
    if (editorViewRef.current) {
      editorViewRef.current.setState(buildEditorState());
      editorViewRef.current.dispatch({
        selection: { anchor: text.length },
      });
    }
  }, [text, vimMode]);

  let onBlurred = false, onEntered = false;

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
        [...placeholderText ? [placeholder(placeholderText)] : []],
        keymap.of([
          {
            key: "Enter",
            run: (view) => {
              onEnter(view);
              return true;
            },
          },
          {
            key: "Escape",
            run: (view) => {
              onBlur(view);
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
          keyup: (event, view) => {
            if (event.key === "Escape") {
              // Esc should be handled by the keymap
              return false;
            }
            if (event.key === "Enter") {
              // Enter should be handled by the keymap, except when in Vim normal mode
              // because then it's disabled
              if (vimMode && vimModeRef.current === "normal") {
                onEnter(view);
                return true;
              }
              return false;
            }
            if (callbacksRef.current!.onKeyUp) {
              return callbacksRef.current!.onKeyUp(view, event);
            }
            return false;
          },
          blur: (_e, view) => {
            onBlur(view);
          },
        }),
        ViewPlugin.fromClass(
          class {
            update(update: ViewUpdate): void {
              if (update.docChanged) {
                callbacksRef.current!.onChange &&
                  callbacksRef.current!.onChange(update.state.sliceDoc());
              }
            }
          },
        ),
      ],
    });

    // Avoid double triggering these events (may happen due to onkeypress vs onkeyup delay)
    function onEnter(view: EditorView) {
      if (onEntered) {
        return;
      }
      onEntered = true;
      callbacksRef.current!.onEnter!(view.state.sliceDoc());
      // Event may occur again in 500ms
      setTimeout(() => {
        onEntered = false;
      }, 500);
    }

    function onBlur(view: EditorView) {
      if (onBlurred) {
        return;
      }
      onBlurred = true;
      callbacksRef.current!.onBlur && callbacksRef.current!.onBlur!();
      if (resetOnBlur) {
        view.setState(buildEditorState());
      }
      // Event may occur again in 500ms
      setTimeout(() => {
        onBlurred = false;
      }, 500);
    }
  }
}
