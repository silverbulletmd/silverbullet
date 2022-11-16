import {
  Decoration,
  DecorationSet,
  EditorView,
  NodeType,
  SyntaxNodeRef,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "../deps.ts";
import { isCursorInRange, iterateTreeInVisibleRanges } from "./util.ts";

// TODO: Find a nicer way to inject this on task handler into the class
function TaskListsPluginFactory(onCheckboxClick: (pos: number) => void) {
  return class TaskListsPlugin {
    decorations: DecorationSet = Decoration.none;
    constructor(
      view: EditorView,
    ) {
      this.decorations = this.addCheckboxes(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = this.addCheckboxes(update.view);
      }
    }
    addCheckboxes(view: EditorView) {
      const widgets: any[] = [];
      iterateTreeInVisibleRanges(view, {
        enter: this.iterateTree(view, widgets),
      });
      return Decoration.set(widgets, true);
    }

    private iterateTree(view: EditorView, widgets: any[]) {
      return ({ type, from, to, node }: SyntaxNodeRef) => {
        if (type.name !== "Task") return;
        let checked = false;
        // Iterate inside the task node to find the checkbox
        node.toTree().iterate({
          enter: (ref) => iterateInner(ref.type, ref.from, ref.to),
        });
        if (checked) {
          widgets.push(
            Decoration.mark({
              tagName: "span",
              class: "cm-task-checked",
            }).range(from, to),
          );
        }

        function iterateInner(type: NodeType, nfrom: number, nto: number) {
          if (type.name !== "TaskMarker") return;
          if (isCursorInRange(view.state, [from + nfrom, from + nto])) return;
          const checkbox = view.state.sliceDoc(from + nfrom, from + nto);
          // Checkbox is checked if it has a 'x' in between the []
          if ("xX".includes(checkbox[1])) checked = true;
          const dec = Decoration.replace({
            widget: new CheckboxWidget(
              checked,
              from + nfrom + 1,
              onCheckboxClick,
            ),
          });
          widgets.push(dec.range(from + nfrom, from + nto));
        }
      };
    }
  };
}

/**
 * Widget to render checkbox for a task list item.
 */
class CheckboxWidget extends WidgetType {
  constructor(
    public checked: boolean,
    readonly pos: number,
    readonly clickCallback: (pos: number) => void,
  ) {
    super();
  }
  toDOM(_view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.classList.add("sb-checkbox");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.addEventListener("click", (e) => {
      // Let the click handler handle this
      e.stopPropagation();

      this.clickCallback(this.pos);
    });
    wrap.appendChild(checkbox);
    return wrap;
  }
}

export function taskListPlugin(
  { onCheckboxClick }: { onCheckboxClick: (pos: number) => void },
) {
  return ViewPlugin.fromClass(TaskListsPluginFactory(onCheckboxClick), {
    decorations: (v) => v.decorations,
  });
}
