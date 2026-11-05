import { StateEffect, StateField, type Transaction } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

const previewDelayMs = 100;

const holdPreview = StateEffect.define<boolean>();

/** A keyboard selection holds the preview; edits, effects and other selections drop it */
function holdChange(tr: Transaction): "hold" | "drop" | "keep" {
  if (tr.docChanged || tr.effects.length > 0) return "drop";
  if (!tr.selection || tr.startState.selection.eq(tr.newSelection)) {
    return "keep";
  }
  if (tr.isUserEvent("select.pointer")) return "keep";
  return !tr.startState.readOnly && tr.isUserEvent("select") ? "hold" : "drop";
}

export const pointerPreviewHeld = StateField.define<boolean>({
  create: () => false,
  update(held, tr) {
    for (const effect of tr.effects) {
      if (effect.is(holdPreview)) return effect.value;
    }
    const change = holdChange(tr);
    return change === "keep" ? held : change === "hold";
  },
});

const pointerPreviewPlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private selecting = false;
    private window: Window;

    constructor(private view: EditorView) {
      this.window = view.dom.ownerDocument.defaultView!;
      this.window.addEventListener("mouseup", this.onMouseUp);
      this.window.addEventListener("blur", this.onWindowBlur);
      // Widget events are filtered before CodeMirror's plugin handlers run.
      view.contentDOM.addEventListener("mousedown", this.onMouseDown, true);
    }

    update(update: ViewUpdate) {
      if (
        !this.selecting &&
        update.transactions.some((tr) => holdChange(tr) === "hold")
      ) {
        this.cancelTimer();
        this.timer = setTimeout(() => this.release(), previewDelayMs);
      }
    }

    private onMouseDown = (event: MouseEvent) => this.start(event);
    private onWindowBlur = () => this.release();

    private cancelTimer() {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    release() {
      this.cancelTimer();
      this.selecting = false;
      if (this.view.state.field(pointerPreviewHeld)) {
        this.view.dispatch({ effects: holdPreview.of(false) });
      }
    }

    onEditorBlur() {
      if (!this.selecting) this.release();
    }

    start(event: MouseEvent) {
      if (event.button !== 0) return;
      this.cancelTimer();
      this.selecting = true;
      this.view.dispatch({ effects: holdPreview.of(true) });
    }

    private onMouseUp = (event: MouseEvent) => {
      if (event.button !== 0 || !this.selecting) return;
      this.selecting = false;
      this.cancelTimer();
      // Let the click reach a wiki widget before source reveal moves its DOM.
      // Ordinary clicks retain geometry for the next press in the sequence.
      this.timer = setTimeout(
        () => this.release(),
        event.altKey ? 0 : previewDelayMs,
      );
    };

    destroy() {
      this.cancelTimer();
      this.window.removeEventListener("mouseup", this.onMouseUp);
      this.window.removeEventListener("blur", this.onWindowBlur);
      this.view.contentDOM.removeEventListener(
        "mousedown",
        this.onMouseDown,
        true,
      );
    }
  },
  {
    eventHandlers: {
      blur() {
        this.onEditorBlur();
      },
    },
  },
);

export const pointerPreview = [pointerPreviewHeld, pointerPreviewPlugin];
