import { syntaxTree } from "@codemirror/language";
import { startCompletion, completionStatus } from "@codemirror/autocomplete";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { NodeType } from "@lezer/common";
import { decoratorStateField, isCursorInRange } from "./util.ts";

/**
 * Widget to render checkbox for a task list item.
 */
class CheckboxWidget extends WidgetType {
  private dom?: HTMLElement;

  constructor(
    public checked: boolean,
    readonly fallbackPos: number,
    readonly clickCallback: (pos: number) => void,
    readonly getView: () => EditorView | null,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.classList.add("sb-checkbox");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    checkbox.addEventListener("mouseup", (e) => {
      e.stopPropagation();
      // Resolve the current document position at click time which
      // prevents stale position corruption when the document has been
      // edited since the decoration was created
      let pos = this.fallbackPos;
      const view = this.getView();
      if (view && this.dom) {
        try {
          const domPos = view.posAtDOM(this.dom, 0);
          pos = domPos + 1;
        } catch {
          // Use fallback
        }
      }
      this.clickCallback(pos);
    });
    // Touch handling for mobile
    let touchCount = 0;
    checkbox.addEventListener("touchmove", () => {
      touchCount++;
    });
    checkbox.addEventListener("touchend", (e) => {
      if (touchCount === 0) {
        e.stopPropagation();
        e.preventDefault();
        let pos = this.fallbackPos;
        const view = this.getView();
        if (view && this.dom) {
          try {
            pos = view.posAtDOM(this.dom, 0) + 1;
          } catch {
            // use fallback
          }
        }
        this.clickCallback(pos);
      }
      touchCount = 0;
    });
    wrap.appendChild(checkbox);
    this.dom = wrap;
    return wrap;
  }
}

/**
 * Tiny widget placed right after an extended task's `]`.
 * Click places cursor inside `[...]` and triggers autocomplete.
 */
class TaskDropdownWidget extends WidgetType {
  constructor(
    // Absolute position of the `[` (start of state content inside brackets)
    readonly stateFrom: number,
    // Absolute position of the `]` (end of TaskState node)
    readonly stateTo: number,
    readonly getView: () => EditorView | null,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "sb-task-dropdown";
    span.textContent = "\u25BE"; // Black Down-Pointing Small Triangle
    span.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    span.addEventListener("click", (e) => {
      e.stopPropagation();
      const view = this.getView();
      if (!view) return;

      const clearFrom = this.stateFrom + 1;
      const clearTo = this.stateTo - 1;
      const originalText = view.state.sliceDoc(clearFrom, clearTo);

      view.dispatch({
        changes: { from: clearFrom, to: clearTo, insert: "" },
        selection: { anchor: clearFrom },
      });
      view.focus();
      startCompletion(view);

      const checkRestore = () => {
        const status = completionStatus(view.state);
        if (status) {
          requestAnimationFrame(checkRestore);
          return;
        }
        const current = view.state.sliceDoc(clearFrom, clearFrom + 1);
        if (current === "]") {
          view.dispatch({
            changes: { from: clearFrom, to: clearFrom, insert: originalText },
          });
        }
      };
      requestAnimationFrame(checkRestore);
    });
    return span;
  }

  eq(other: TaskDropdownWidget): boolean {
    return this.stateFrom === other.stateFrom && this.stateTo === other.stateTo;
  }
}

export function taskListPlugin({
  onCheckboxClick,
  getView,
  doneStates,
}: {
  onCheckboxClick: (pos: number) => void;
  getView: () => EditorView | null;
  doneStates?: Set<string>;
}) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter({ type, from, to, node }) {
        if (type.name !== "Task") return;
        // true/false if this is a checkbox, undefined when it's a custom-status task
        let checkboxStatus: boolean | undefined;
        // Track TaskState end position for strikethrough start
        let taskStateEnd = -1;

        node.toTree().iterate({
          enter: (ref) => iterateInner(ref.type, ref.from, ref.to),
        });

        if (checkboxStatus === true) {
          // Skip whitespace after TaskState
          let strikeFrom = taskStateEnd !== -1 ? taskStateEnd : from;
          while (
            strikeFrom < to &&
            " \t".includes(state.sliceDoc(strikeFrom, strikeFrom + 1))
          ) {
            strikeFrom++;
          }
          if (strikeFrom < to) {
            widgets.push(
              Decoration.mark({
                tagName: "span",
                class: "cm-task-checked",
              }).range(strikeFrom, to),
            );
          }
        }

        function iterateInner(type: NodeType, nfrom: number, nto: number) {
          if (type.name !== "TaskState") return;
          taskStateEnd = from + nto;
          const checkbox = state.sliceDoc(from + nfrom, from + nto);
          if (checkbox === "[x]" || checkbox === "[X]") {
            checkboxStatus = true;
          } else if (checkbox === "[ ]") {
            checkboxStatus = false;
          }
          if (checkboxStatus === undefined) {
            const stateText = checkbox.slice(1, -1);
            if (doneStates?.has(stateText)) {
              checkboxStatus = true;
            }
            // Mark the full TaskState node
            widgets.push(
              Decoration.mark({
                attributes: { "data-task-state": stateText },
              }).range(from + nfrom, from + nto),
            );
            // Always show dropdown
            const absTo = from + nto;
            const dec = Decoration.widget({
              widget: new TaskDropdownWidget(from + nfrom, absTo, getView),
              side: 1,
            });
            widgets.push(dec.range(absTo));
            return;
          }
          if (isCursorInRange(state, [from + nfrom, from + nto])) return;
          const dec = Decoration.replace({
            widget: new CheckboxWidget(
              checkboxStatus,
              from + nfrom + 1,
              onCheckboxClick,
              getView,
            ),
          });
          widgets.push(dec.range(from + nfrom, from + nto));
        }
      },
    });
    return Decoration.set(widgets, true);
  });
}
