import {
  acceptCompletion,
  currentCompletions,
  setSelectedCompletion,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";

const isIOS =
  typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const tapSlop = 10;

const iosCompletionTapPlugin = ViewPlugin.fromClass(
  class {
    touchStart: { x: number; y: number } | null = null;

    constructor(readonly view: EditorView) {
      view.dom.addEventListener("touchstart", this.onTouchStart, {
        capture: true,
        passive: true,
      });
      view.dom.addEventListener("touchend", this.onTouchEnd, true);
    }

    destroy() {
      this.view.dom.removeEventListener("touchstart", this.onTouchStart, true);
      this.view.dom.removeEventListener("touchend", this.onTouchEnd, true);
    }

    onTouchStart = (event: TouchEvent) => {
      const touch = event.touches.length === 1 ? event.touches[0] : null;
      this.touchStart = touch && { x: touch.clientX, y: touch.clientY };
    };

    onTouchEnd = (event: TouchEvent) => {
      const start = this.touchStart;
      this.touchStart = null;
      const touch = event.changedTouches[0];
      if (
        !start ||
        !touch ||
        Math.abs(touch.clientX - start.x) > tapSlop ||
        Math.abs(touch.clientY - start.y) > tapSlop
      ) {
        return;
      }
      const index = completionOptionIndex(event.target);
      if (
        index === null ||
        index >= currentCompletions(this.view.state).length
      ) {
        return;
      }
      event.preventDefault();
      this.view.dispatch({ effects: setSelectedCompletion(index) });
      acceptCompletion(this.view);
    };
  },
);

export function completionOptionIndex(target: EventTarget | null) {
  const option =
    target instanceof Element
      ? target.closest(".cm-tooltip-autocomplete li[id]")
      : null;
  const match = option && /-(\d+)$/.exec(option.id);
  return match ? +match[1] : null;
}

export function iosCompletionTapHandling(): Extension {
  return isIOS ? iosCompletionTapPlugin : [];
}
