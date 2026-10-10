import { EditorSelection, type Extension } from "@codemirror/state";
import {
  type EditorView,
  runScopeHandlers,
  ViewPlugin,
} from "@codemirror/view";

const isIOS =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

// CodeMirror lets iOS insert Enter natively and replays it as a synthetic key
// once the DOM change arrives, or after a 50ms timeout. When the native line
// break lands after that timeout, Enter is applied twice. Separately, the tap
// that opens the keyboard can leave CodeMirror's selection out of sync with the
// native caret. So on iOS we take over Enter at beforeinput, where the native
// caret is authoritative, and run the keymap exactly once.
const iosEnterPlugin = ViewPlugin.fromClass(
  class {
    pendingKey: KeyboardEvent | null = null;
    fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    suppressLineBreakUntil = 0;

    constructor(readonly view: EditorView) {
      view.dom.addEventListener("keydown", this.onKeyDown, true);
      view.dom.addEventListener("beforeinput", this.onBeforeInput, true);
    }

    destroy() {
      this.view.dom.removeEventListener("keydown", this.onKeyDown, true);
      this.view.dom.removeEventListener(
        "beforeinput",
        this.onBeforeInput,
        true,
      );
      clearTimeout(this.fallbackTimer);
    }

    onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Enter" ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing ||
        // deno-lint-ignore no-explicit-any
        (event as any).synthetic ||
        !this.handlesInput(event.target)
      ) {
        return;
      }
      // Keep CodeMirror from scheduling its own delayed Enter, but leave the
      // default action alone so iOS still fires beforeinput and its keyboard
      // state (auto-capitalization) stays correct.
      event.stopPropagation();
      this.pendingKey = event;
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = setTimeout(() => {
        this.runEnter();
        this.suppressLineBreakUntil = Date.now() + 1000;
      }, 500);
    };

    onBeforeInput = (event: InputEvent) => {
      if (
        (event.inputType !== "insertParagraph" &&
          event.inputType !== "insertLineBreak") ||
        event.isComposing ||
        !this.handlesInput(event.target)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!this.pendingKey && Date.now() < this.suppressLineBreakUntil) {
        return;
      }
      this.runEnter();
    };

    handlesInput(target: EventTarget | null): boolean {
      const view = this.view;
      return (
        target === view.contentDOM &&
        !view.composing &&
        !view.state.readOnly &&
        view.contentDOM.isContentEditable
      );
    }

    runEnter() {
      clearTimeout(this.fallbackTimer);
      const shiftKey =
        (this.pendingKey?.shiftKey ?? false) && !this.autoShift();
      this.pendingKey = null;
      this.syncSelectionFromDOM();
      const view = this.view;
      const enter = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        shiftKey,
      });
      if (!runScopeHandlers(view, enter, "editor")) {
        view.dispatch(view.state.replaceSelection(view.state.lineBreak), {
          scrollIntoView: true,
          userEvent: "input",
        });
      }
    }

    // With autocapitalize on, the virtual keyboard reports Shift at the start
    // of every sentence; treating that as Shift-Enter would skip our keymap.
    autoShift(): boolean {
      const vv = globalThis.visualViewport;
      return (
        !/^(off|none)$/.test(this.view.contentDOM.autocapitalize) &&
        !!vv &&
        (vv.height * vv.scale) / document.documentElement.clientHeight < 0.85
      );
    }

    syncSelectionFromDOM() {
      const view = this.view;
      const domSel = document.getSelection();
      if (
        view.state.selection.ranges.length > 1 ||
        !domSel?.anchorNode ||
        !domSel.focusNode ||
        !view.contentDOM.contains(domSel.anchorNode) ||
        !view.contentDOM.contains(domSel.focusNode)
      ) {
        return;
      }
      const anchor = view.posAtDOM(domSel.anchorNode, domSel.anchorOffset);
      const head = view.posAtDOM(domSel.focusNode, domSel.focusOffset);
      const main = view.state.selection.main;
      if (anchor !== main.anchor || head !== main.head) {
        view.dispatch({
          selection: EditorSelection.single(anchor, head),
          userEvent: "select",
        });
      }
    }
  },
);

export function iosEnterHandling(): Extension {
  return isIOS ? iosEnterPlugin : [];
}
