import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

// Android keyboards can report an old native caret after CodeMirror updates
// the DOM. Its next keydown flush would adopt that caret and misplace the input.
// A capture listener restores the editor caret before that flush, but only
// within 250 ms of typing/deletion and while native text matches editor state.
// Touch, composition, selected ranges and pauses leave the native caret in charge.
const inputSelectionPlugin = ViewPlugin.fromClass(
  class {
    typing = false;
    inputUntil = 0;

    constructor(readonly view: EditorView) {
      view.dom.addEventListener("keydown", this.onKeyDown, true);
      view.dom.addEventListener("pointerdown", this.onPointerDown, true);
      view.dom.addEventListener("compositionstart", this.onPointerDown, true);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.typing = update.transactions.some(
          (tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"),
        );
        this.inputUntil = Date.now() + 250;
      } else if (
        update.transactions.some(
          (tr) => tr.selection && !tr.isUserEvent("select"),
        )
      ) {
        this.typing = false;
      }
    }

    onPointerDown = () => {
      this.typing = false;
    };

    onKeyDown = (event: KeyboardEvent) => {
      const view = this.view;
      if (
        event.target !== view.contentDOM ||
        event.key.length !== 1 ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing ||
        view.compositionStarted ||
        view.state.readOnly ||
        !view.contentDOM.isContentEditable ||
        view.state.selection.ranges.length !== 1 ||
        !view.state.selection.main.empty
      ) {
        this.typing = false;
        return;
      }
      if (!this.typing || Date.now() > this.inputUntil) return;
      const selection = view.contentDOM.ownerDocument.getSelection();
      if (
        !selection?.isCollapsed ||
        !selection.focusNode ||
        !view.contentDOM.contains(selection.focusNode) ||
        (selection.focusNode.nodeType !== Node.TEXT_NODE &&
          selection.focusNode.textContent !== "")
      ) {
        this.typing = false;
        return;
      }

      const pos = view.domAtPos(view.state.selection.main.head);
      for (const node of [selection.focusNode, pos.node]) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        const text = node.nodeValue!;
        const from = view.posAtDOM(node, 0);
        const to = view.posAtDOM(node, text.length);
        if (view.state.sliceDoc(from, to) !== text) {
          this.typing = false;
          return;
        }
      }

      selection.collapse(pos.node, pos.offset);
    };

    destroy() {
      this.view.dom.removeEventListener("keydown", this.onKeyDown, true);
      this.view.dom.removeEventListener(
        "pointerdown",
        this.onPointerDown,
        true,
      );
      this.view.dom.removeEventListener(
        "compositionstart",
        this.onPointerDown,
        true,
      );
    }
  },
);

export function androidInputSelection(): Extension {
  return typeof navigator !== "undefined" && /Android/.test(navigator.userAgent)
    ? inputSelectionPlugin
    : [];
}
