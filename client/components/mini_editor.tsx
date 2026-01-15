import { useEffect, useRef } from "preact/hooks";
import { history, historyKeymap, standardKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { getCM as vimGetCm, Vim, vim } from "@replit/codemirror-vim";
import { createCommandKeyBindings } from "../codemirror/editor_state.ts";

type MiniEditorEvents = {
  onEnter: (newText: string, shiftDown?: boolean) => void;
  onEscape?: (newText: string) => void;
  onBlur?: (newText: string) => void | Promise<void>;
  onChange?: (newText: string) => void;
  onKeyUp?: (view: EditorView, event: KeyboardEvent) => boolean;
  onKeyDown?: (view: EditorView, event: KeyboardEvent) => boolean;
};

export function MiniEditor(
  {
    text,
    placeholderText,
    vimMode,
    darkMode,
    vimStartInInsertMode,
    onBlur,
    onEscape,
    onKeyUp,
    onKeyDown,
    onEnter,
    onChange,
    focus,
    editable,
  }: {
    text: string;
    placeholderText?: string;
    vimMode: boolean;
    darkMode?: boolean;
    vimStartInInsertMode?: boolean;
    focus?: boolean;
    editable: boolean;
  } & MiniEditorEvents,
) {
  const editorDiv = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView>();
  const vimModeRef = useRef<string>("normal");
  // TODO: This super duper ugly, but I don't know how to avoid it
  // Due to how MiniCodeEditor is built, it captures the closures of all callback functions
  // which results in them pointing to old state variables, to avoid this we do this...
  const callbacksRef = useRef<MiniEditorEvents>();

  useEffect(() => {
    const currentEditorDiv = editorDiv.current;
    if (currentEditorDiv) {
      // console.log("Creating editor view");
      const editorView = new EditorView({
        state: buildEditorState(),
        parent: currentEditorDiv,
      });
      editorViewRef.current = editorView;

      const focusEditorView = editorView.focus.bind(editorView);
      currentEditorDiv.addEventListener("focusin", focusEditorView);

      if (focus) {
        editorView.focus();
        // Put cursor at the very end
        editorView.dispatch({
          selection: { anchor: text.length },
        });
      }

      return () => {
        currentEditorDiv.removeEventListener("focusin", focusEditorView);
        if (editorViewRef.current) {
          editorViewRef.current.destroy();
        }
      };
    }
  }, [editorDiv, placeholderText]);

  useEffect(() => {
    callbacksRef.current = {
      onBlur,
      onEnter,
      onEscape,
      onKeyUp,
      onKeyDown,
      onChange,
    };
  });

  useEffect(() => {
    if (editorViewRef.current) {
      const currentEditorText = editorViewRef.current.state.sliceDoc();
      if (currentEditorText !== text) {
        editorViewRef.current.setState(buildEditorState());
        editorViewRef.current.dispatch({
          selection: { anchor: text.length },
        });
      }
    }
  }, [text, vimMode]);

  let onBlurred = false, onEntered = false;

  return (
    <div
      class="sb-mini-editor"
      onKeyDownCapture={(e) => {
        let stopPropagation = false;
        if (callbacksRef.current!.onKeyDown) {
          stopPropagation = callbacksRef.current!.onKeyDown(
            editorViewRef.current!,
            e,
          );
        }
        if (stopPropagation) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      ref={editorDiv}
    />
  );

  function buildEditorState() {
    // When vim mode is active, we need for CM to have created the new state
    // and the subscribe to the vim mode's events
    // This needs to happen in the next tick, so we wait a tick with setTimeout
    if (vimMode) {
      // Only applies to vim mode
      setTimeout(() => {
        const cm = vimGetCm(editorViewRef.current!)!;
        cm.on("vim-mode-change", ({ mode }: { mode: string }) => {
          vimModeRef.current = mode;
        });
        if (vimStartInInsertMode) {
          Vim.handleKey(cm, "i", "+input");
        }
      });
    }
    return EditorState.create({
      doc: text,
      extensions: [
        EditorView.theme({}, { dark: darkMode }),
        // Enable vim mode, or not
        [...vimMode ? [vim()] : []],
        [
          ...editable
            ? []
            : [EditorView.editable.of(false), EditorState.readOnly.of(true)],
        ],
        history(),
        [...placeholderText ? [placeholder(placeholderText)] : []],
        keymap.of([
          {
            key: "Enter",
            run: (view) => {
              onEnter(view, false);
              return true;
            },
          },
          {
            key: "Shift-Enter",
            run: (view) => {
              onEnter(view, true);
              return true;
            },
          },
          {
            key: "Escape",
            run: (view) => {
              callbacksRef.current!.onEscape &&
                callbacksRef.current!.onEscape(view.state.sliceDoc());
              return true;
            },
          },
          ...standardKeymap,
          ...historyKeymap,
          ...createCommandKeyBindings(globalThis.client),
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
                onEnter(view, event.shiftKey);
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
    function onEnter(view: EditorView, shiftDown: boolean) {
      if (onEntered) {
        return;
      }
      onEntered = true;
      callbacksRef.current!.onEnter(view.state.sliceDoc(), shiftDown);
      // Event may occur again in 500ms
      setTimeout(() => {
        onEntered = false;
      }, 500);
    }

    function onBlur(view: EditorView) {
      if (onBlurred || onEntered) {
        return;
      }
      onBlurred = true;
      if (callbacksRef.current!.onBlur) {
        Promise.resolve(callbacksRef.current!.onBlur(view.state.sliceDoc()))
          .catch(() => {
            // Reset the state
            view.setState(buildEditorState());
          });
      }
      // Event may occur again in 500ms
      setTimeout(() => {
        onBlurred = false;
      }, 500);
    }
  }
}
