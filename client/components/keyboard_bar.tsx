import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import * as featherIcons from "preact-feather";
import type { Client } from "../client.ts";
import { resolveButtonIcon } from "../lib/feather_icons.ts";
import { parseIcon, resolveIconMarkup } from "../lib/icon.ts";
import {
  KEYBOARD_PRESENT_INSET,
  keyboardViewportState,
  subscribeKeyboardViewport,
} from "../lib/keyboard_viewport.ts";
import {
  matchesNodeContexts,
  type NodeContextFilter,
} from "../lib/node_contexts.ts";

export type KeyboardBarButton = NodeContextFilter & {
  icon: string;
  description?: string;
  command?: string;
  run?: () => void;
};

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

function ButtonIcon({ icon }: { icon: string }) {
  const parsed = parseIcon(icon);
  if (parsed.kind === "svg") {
    const markup = resolveIconMarkup(icon);
    return markup ? (
      <span
        className="sb-keyboard-bar-svg"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    ) : null;
  }
  const Icon = resolveButtonIcon(
    parsed.kind === "feather" ? parsed.name : icon,
  );
  return <Icon size={20} />;
}

function cursorParentNodes(client: Client): string[] {
  const state = client.editorView.state;
  const head = state.selection.main.head;
  // At the start of a line, look forward so the cursor counts as inside the
  // item on that line rather than the node that ended on the line before.
  const side = head === state.doc.lineAt(head).from ? 1 : -1;
  return client.extractParentNodes(
    state,
    syntaxTree(state).resolveInner(head, side),
  );
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
      const next = cursorParentNodes(client);
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
  buttons: KeyboardBarButton[];
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
    !client.isReadOnlyMode();
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

  const run = (button: KeyboardBarButton) => {
    if (button.command) {
      void client.runCommandByName(button.command);
    } else {
      button.run?.();
    }
  };

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
        {buttons
          .filter((button) => matchesNodeContexts(button, parentNodes))
          .map((button, index) => {
            return (
              <button
                type="button"
                key={index}
                title={button.description ?? button.command}
                aria-label={button.description ?? button.command}
                onClick={() => run(button)}
              >
                <ButtonIcon icon={button.icon} />
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
