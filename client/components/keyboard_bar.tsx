import { EditorView } from "@codemirror/view";
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import * as featherIcons from "preact-feather";
import type { Client } from "../client.ts";
import {
  KEYBOARD_PRESENT_INSET,
  keyboardViewportState,
  subscribeKeyboardViewport,
} from "../lib/keyboard_viewport.ts";
import {
  buttonLabel,
  type MarkupButton,
  markupSurfaces,
  runMarkupButton,
} from "../lib/markup_buttons.ts";
import { MarkupIcon } from "../lib/markup_icons.ts";
import { contextsAt, matchesNodeContexts } from "../lib/node_contexts.ts";

/** Leaves room for at least a few editor lines next to the bar. */
const MIN_VISIBLE_HEIGHT = 200;

function useKeyboardViewport() {
  const [state, setState] = useState(keyboardViewportState);
  useEffect(() => subscribeKeyboardViewport(setState), []);
  return state;
}

function useEditorFocused(client: Client) {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const update = () =>
      setFocused(
        !!client.editorView?.contentDOM.contains(document.activeElement),
      );
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, [client]);
  return focused;
}

function sameNodes(a: string[], b: string[]) {
  return a.length === b.length && a.every((node, i) => node === b[i]);
}

function useCursorContext(client: Client, enabled: boolean) {
  const [nodes, setNodes] = useState<string[]>([]);
  // Layout effect: the bar's first paint already shows the right buttons.
  useLayoutEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      const state = client.editorView.state;
      const next = contextsAt(client, state, state.selection.main.head);
      setNodes((prev) => (sameNodes(prev, next) ? prev : next));
    };
    let frame = 0;
    // CodeMirror applies the DOM selection to its state in its own
    // selectionchange handler; read the state a frame later.
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refresh);
    };
    refresh();
    document.addEventListener("selectionchange", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
    };
  }, [client, enabled]);
  return nodes;
}

export function KeyboardBar({
  client,
  buttons,
}: {
  client: Client;
  buttons: MarkupButton[];
}) {
  const viewport = useKeyboardViewport();
  const focused = useEditorFocused(client);
  const keyboardPresent =
    viewport.keyboardInset >= KEYBOARD_PRESENT_INSET ||
    viewport.hardwareKeyboard;
  const editing = focused && keyboardPresent;
  const visible =
    editing &&
    viewport.visibleHeight >= MIN_VISIBLE_HEIGHT &&
    markupSurfaces(client, client.editorView?.state).mobile;
  const parentNodes = useCursorContext(client, visible);

  // Shrinking the editor to make room for the keyboard (or rotating with it
  // up) can leave the cursor below the fold.
  useEffect(() => {
    if (!editing) return;
    const view = client.editorView;
    view.dispatch({
      effects: EditorView.scrollIntoView(view.state.selection.main.head, {
        y: "nearest",
        yMargin: 24,
      }),
    });
  }, [editing, visible, viewport.visibleHeight]);

  if (!visible) return null;

  return (
    <div
      className="sb-keyboard-bar"
      role="toolbar"
      aria-label="Editing shortcuts"
      data-docked={viewport.keyboardInset < 1 ? "" : undefined}
      // Keeps focus (and the on-screen keyboard) in the editor.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="sb-keyboard-bar-buttons">
        {buttons.map((button, index) => {
          // Keyed by place in the configured list, so a button keeps its
          // element while others come and go
          if (!matchesNodeContexts(button, parentNodes)) return null;
          return (
            <button
              type="button"
              key={index}
              title={buttonLabel(button)}
              aria-label={buttonLabel(button)}
              onClick={() => runMarkupButton(client, button)}
            >
              <MarkupIcon icon={button.icon} />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="sb-keyboard-bar-dismiss"
        title="Hide keyboard"
        aria-label="Hide keyboard"
        onClick={() => client.editorView.contentDOM.blur()}
      >
        <featherIcons.ChevronDown size={20} />
      </button>
    </div>
  );
}
