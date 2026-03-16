import { syntaxTree } from "@codemirror/language";
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

export function taskListPlugin({
  onCheckboxClick,
  getView,
}: {
  onCheckboxClick: (pos: number) => void;
  getView: () => EditorView | null;
}) {
  return decoratorStateField((state) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter({ type, from, to, node }) {
        if (type.name !== "Task") return;
        // true/false if this is a checkbox, undefined when it's a custom-status task
        let checkboxStatus: boolean | undefined;
        // Iterate inside the task node to find the checkbox
        node.toTree().iterate({
          enter: (ref) => iterateInner(ref.type, ref.from, ref.to),
        });
        if (checkboxStatus === true) {
          widgets.push(
            Decoration.mark({
              tagName: "span",
              class: "cm-task-checked",
            }).range(from, to),
          );
        }

        function iterateInner(type: NodeType, nfrom: number, nto: number) {
          if (type.name !== "TaskState") return;
          if (isCursorInRange(state, [from + nfrom, from + nto])) return;
          const checkbox = state.sliceDoc(from + nfrom, from + nto);
          // Checkbox is checked if it has a 'x' in between the []
          if (checkbox === "[x]" || checkbox === "[X]") {
            checkboxStatus = true;
          } else if (checkbox === "[ ]") {
            checkboxStatus = false;
          }
          if (checkboxStatus === undefined) {
            // Not replacing it with a widget
            return;
          }
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
