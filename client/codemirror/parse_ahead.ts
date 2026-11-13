import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { parsedFurther } from "./decoration_regions.ts";

// CodeMirror parses only ~100k characters past the viewport. Past that a page
// shows no live preview yet, so its estimated height changes by thousands of
// pixels once scrolling gets there. Finishing the parse while idle settles it
// early. Above this size, rebuilding every decoration (after a save, say)
// costs more than the late height change.
const maxLength = 500_000;
// Per idle slice, so typing never waits on it
const sliceMs = 5;

type Idle = { cancel(): void };

function whenIdle(run: () => void): Idle {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: 2000 });
    return { cancel: () => cancelIdleCallback(id) };
  }
  const id = setTimeout(run, 50);
  return { cancel: () => clearTimeout(id) };
}

/** Parses the rest of the page in idle time, a slice at a time */
export const parseAhead = ViewPlugin.fromClass(
  class {
    private pending: Idle | null = null;

    constructor(readonly view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.schedule();
    }

    private schedule() {
      if (this.pending) return;
      this.pending = whenIdle(() => {
        this.pending = null;
        this.work();
      });
    }

    private work() {
      const { state } = this.view;
      const length = state.doc.length;
      if (length > maxLength || syntaxTree(state).length >= length) return;
      ensureSyntaxTree(state, length, sliceMs);
      // The new tree only reaches the state with a transaction
      this.view.dispatch({ annotations: parsedFurther.of(true) });
      this.schedule();
    }

    destroy() {
      this.pending?.cancel();
    }
  },
);
