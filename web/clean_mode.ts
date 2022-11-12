import {
  ChangeSpec,
  Decoration,
  DecorationSet,
  EditorState,
  EditorView,
  foldedRanges,
  NodeType,
  SyntaxNodeRef,
  syntaxTree,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "./deps.ts";

function getLinkAnchor(view: EditorView) {
  const widgets: any[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: ({ type, from, to, node }) => {
        if (type.name !== "URL") return;
        const parent = node.parent;
        const blackListedParents = ["Image"];
        if (parent && !blackListedParents.includes(parent.name)) {
          const marks = parent.getChildren("LinkMark");
          const ranges = view.state.selection.ranges;
          const cursorOverlaps = ranges.some(({ from, to }) =>
            checkRangeOverlap([from, to], [parent.from, parent.to])
          );
          if (!cursorOverlaps) {
            widgets.push(
              ...marks.map(({ from, to }) =>
                invisibleDecoration.range(from, to)
              ),
              invisibleDecoration.range(from, to),
            );
          }
        }
      },
    });
  }

  return Decoration.set(widgets, true);
}

export const goToLinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = getLinkAnchor(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = getLinkAnchor(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

class StartDirectiveWidget extends WidgetType {
  constructor() {
    super();
  }
  toDOM(): HTMLElement {
    const queryEl = document.createElement("div");
    queryEl.textContent = "start";
    queryEl.className = "sb-directive-start";
    console.log("Got dom", queryEl);
    return queryEl;
  }
}

function getDirectives(view: EditorView) {
  const widgets: any[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: ({ type, from, to }) => {
        if (type.name !== "CommentBlock") {
          return;
        }
        const text = view.state.sliceDoc(from, to);
        if (/<!--\s*#/.exec(text)) {
          // Open directive
          console.log("Open diretive", text);
          widgets.push(
            Decoration.line({
              class: "sb-directive-start",
            }).range(from),
          );
        } else if (/<!--\s*\//.exec(text)) {
          console.log("Close diretive", text);
          widgets.push(
            Decoration.line({
              class: "sb-directive-end",
            }).range(from),
          );
        } else {
          return;
        }
        if (!isCursorInRange(view.state, [from, to])) {
          widgets.push(
            Decoration.line({
              class: "sb-directive-outside",
            }).range(from),
          );
        }
      },
    });
  }

  return Decoration.set(widgets, true);
}

export const directivePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = getDirectives(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = getDirectives(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// HIDE MARKS

/**
 * These types contain markers as child elements that can be hidden.
 */
const typesWithMarks = [
  "Emphasis",
  "StrongEmphasis",
  "InlineCode",
  "Strikethrough",
  "WikiLink",
  "CommandLink",
];
/**
 * The elements which are used as marks.
 */
const markTypes = [
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "WikiLinkMark",
  "CommandLinkMark",
];

/**
 * Plugin to hide marks when the they are not in the editor selection.
 */
class HideMarkPlugin {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.compute(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.compute(update.view);
    }
  }
  compute(view: EditorView): DecorationSet {
    const widgets: any[] = [];
    let parentRange: [number, number];
    iterateTreeInVisibleRanges(view, {
      enter: ({ type, from, to, node }) => {
        if (typesWithMarks.includes(type.name)) {
          // There can be a possibility that the current node is a
          // child eg. a bold node in a emphasis node, so check
          // for that or else save the node range
          if (
            parentRange &&
            checkRangeOverlap([from, to], parentRange)
          ) {
            return;
          } else parentRange = [from, to];
          if (isCursorInRange(view.state, [from, to])) return;
          const innerTree = node.toTree();
          innerTree.iterate({
            enter({ type, from: markFrom, to: markTo }) {
              // Check for mark types and push the replace
              // decoration
              if (!markTypes.includes(type.name)) return;
              widgets.push(
                invisibleDecoration.range(
                  from + markFrom,
                  from + markTo,
                ),
              );
            },
          });
        }
      },
    });
    return Decoration.set(widgets, true);
  }
}

/**
 * Ixora hide marks plugin.
 *
 * This plugin allows to:
 * - Hide marks when they are not in the editor selection.
 */
export const hideMarks = () => [
  ViewPlugin.fromClass(HideMarkPlugin, {
    decorations: (v) => v.decorations,
  }),
];

// HEADINGS

class HideHeaderMarkPlugin {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.hideHeaderMark(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.hideHeaderMark(update.view);
    }
  }
  /**
   * Function to decide if to insert a decoration to hide the header mark
   * @param view - Editor view
   * @returns The `Decoration`s that hide the header marks
   */
  private hideHeaderMark(view: EditorView) {
    const widgets: any[] = [];
    const ranges = view.state.selection.ranges;
    iterateTreeInVisibleRanges(view, {
      enter: ({ type, from, to }) => {
        // Get the active line
        const line = view.lineBlockAt(from);
        // If any cursor overlaps with the heading line, skip
        const cursorOverlaps = ranges.some(({ from, to }) =>
          checkRangeOverlap([from, to], [line.from, line.to])
        );
        if (cursorOverlaps) return;
        if (
          type.name === "HeaderMark" &&
          // Setext heading's horizontal lines are not hidden.
          /[#]/.test(view.state.sliceDoc(from, to))
        ) {
          const dec = Decoration.replace({});
          widgets.push(dec.range(from, to + 1));
        }
      },
    });
    return Decoration.set(widgets, true);
  }
}

/**
 * Plugin to hide the header mark.
 *
 * The header mark will not be hidden when:
 * - The cursor is on the active line
 * - The mark is on a line which is in the current selection
 */
export const hideHeaderMarkPlugin = ViewPlugin.fromClass(HideHeaderMarkPlugin, {
  decorations: (v) => v.decorations,
});

// IMAGE

function hideNodes(view: EditorView) {
  const widgets: any[] = [];
  iterateTreeInVisibleRanges(view, {
    enter(node) {
      if (
        node.name === "Image" &&
        !isCursorInRange(view.state, [node.from, node.to])
      ) {
        widgets.push(invisibleDecoration.range(node.from, node.to));
      }
    },
  });
  return Decoration.set(widgets, true);
}

export const hideImageNodePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = hideNodes(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        this.decorations = hideNodes(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// BLOCKQUOTE

const quoteMarkRE = /^(\s*>+)/gm;
/**
 * Plugin to add style blockquotes.
 */
class BlockQuotePlugin {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.styleBlockquote(view);
  }
  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet
    ) {
      this.decorations = this.styleBlockquote(update.view);
    }
  }
  /**
   * @param view - The editor view
   * @returns The blockquote decorations to add to the editor
   */
  private styleBlockquote(view: EditorView): DecorationSet {
    const widgets: any[] = [];
    iterateTreeInVisibleRanges(view, {
      enter: ({ name, from, to }) => {
        if (name !== "Blockquote") return;
        const lines = editorLines(view, from, to);

        lines.forEach((line) => {
          const lineDec = Decoration.line({
            class: "sb-blockquote",
          });
          widgets.push(lineDec.range(line.from));
        });

        if (
          lines.every(
            (line) => !isCursorInRange(view.state, [line.from, line.to]),
          )
        ) {
          const marks = Array.from(
            view.state.sliceDoc(from, to).matchAll(quoteMarkRE),
          )
            .map((x) => from + x.index!)
            .map((i) =>
              Decoration.line({
                class: "sb-blockquote-outside",
              }).range(i)
            );
          // lines.forEach((line) => {
          //   if (
          //     !marks.some((mark) =>
          //       checkRangeSubset(
          //         [line.from, line.to],
          //         [mark.from, mark.to],
          //       )
          //     )
          //   ) {
          //     marks.push(
          //       Decoration.widget({
          //         widget: new BlockQuoteBorderWidget(),
          //       }).range(line.from),
          //     );
          //   }
          // });

          widgets.push(...marks);
        }
      },
    });
    return Decoration.set(widgets, true);
  }
}

export const blockQuotePlugin = ViewPlugin.fromClass(BlockQuotePlugin, {
  decorations: (v) => v.decorations,
});

// LISTS

const bulletListMarkerRE = /^[-+*]/;

/**
 * Plugin to add custom list bullet mark.
 */
class ListBulletPlugin {
  decorations: DecorationSet = Decoration.none;
  constructor(view: EditorView) {
    this.decorations = this.decorateLists(view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = this.decorateLists(update.view);
    }
  }
  private decorateLists(view: EditorView) {
    const widgets: any[] = [];
    iterateTreeInVisibleRanges(view, {
      enter: ({ type, from, to }) => {
        if (isCursorInRange(view.state, [from, to])) return;
        if (type.name === "ListMark") {
          const listMark = view.state.sliceDoc(from, to);
          if (bulletListMarkerRE.test(listMark)) {
            const dec = Decoration.replace({
              widget: new ListBulletWidget(listMark),
            });
            widgets.push(dec.range(from, to));
          }
        }
      },
    });
    return Decoration.set(widgets, true);
  }
}
export const listBulletPlugin = ViewPlugin.fromClass(ListBulletPlugin, {
  decorations: (v) => v.decorations,
});

/**
 * Widget to render list bullet mark.
 */
class ListBulletWidget extends WidgetType {
  constructor(readonly bullet: string) {
    super();
  }
  toDOM(): HTMLElement {
    const listBullet = document.createElement("span");
    listBullet.textContent = this.bullet;
    listBullet.className = "cm-list-bullet";
    return listBullet;
  }
}

/**
 * Plugin to add checkboxes in task lists.
 */
class TaskListsPlugin {
  decorations: DecorationSet = Decoration.none;
  constructor(view: EditorView) {
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
          widget: new CheckboxWidget(checked, from + nfrom + 1),
        });
        widgets.push(dec.range(from + nfrom, from + nto));
      }
    };
  }
}

/**
 * Widget to render checkbox for a task list item.
 */
class CheckboxWidget extends WidgetType {
  constructor(public checked: boolean, readonly pos: number) {
    super();
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.classList.add("sb-checkbox");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.addEventListener("click", ({ target }) => {
      const change: ChangeSpec = {
        from: this.pos,
        to: this.pos + 1,
        insert: this.checked ? " " : "x",
      };
      view.dispatch({ changes: change });
      this.checked = !this.checked;
      (target as HTMLInputElement).checked = this.checked;
    });
    wrap.appendChild(checkbox);
    return wrap;
  }
}

export const taskListPlugin = ViewPlugin.fromClass(TaskListsPlugin, {
  decorations: (v) => v.decorations,
});

// UTILS

/**
 * Check if two ranges overlap
 * Based on the visual diagram on https://stackoverflow.com/a/25369187
 * @param range1 - Range 1
 * @param range2 - Range 2
 * @returns True if the ranges overlap
 */
function checkRangeOverlap(
  range1: [number, number],
  range2: [number, number],
) {
  return range1[0] <= range2[1] && range2[0] <= range1[1];
}

/**
 * Check if a range is inside another range
 * @param parent - Parent (bigger) range
 * @param child - Child (smaller) range
 * @returns True if child is inside parent
 */
function checkRangeSubset(
  parent: [number, number],
  child: [number, number],
) {
  return child[0] >= parent[0] && child[1] <= parent[1];
}

/**
 * Check if any of the editor cursors is in the given range
 * @param state - Editor state
 * @param range - Range to check
 * @returns True if the cursor is in the range
 */
function isCursorInRange(state: EditorState, range: [number, number]) {
  return state.selection.ranges.some((selection) =>
    checkRangeOverlap(range, [selection.from, selection.to])
  );
}

/**
 * Decoration to simply hide anything.
 */
const invisibleDecoration = Decoration.replace({});

export function iterateTreeInVisibleRanges(
  view: EditorView,
  iterateFns: {
    enter(node: SyntaxNodeRef): boolean | void;
    leave?(node: SyntaxNodeRef): void;
  },
) {
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({ ...iterateFns, from, to });
  }
}

/**
 * Returns the lines of the editor that are in the given range and not folded.
 * This function is of use when you need to get the lines of a particular
 * block node and add line decorations to each line of it.
 *
 * @param view - Editor view
 * @param from - Start of the range
 * @param to - End of the range
 * @returns A list of line blocks that are in the range
 */
export function editorLines(view: EditorView, from: number, to: number) {
  let lines = view.viewportLineBlocks.filter((block) =>
    // Keep lines that are in the range
    checkRangeOverlap([block.from, block.to], [from, to])
  );

  const folded = foldedRanges(view.state).iter();
  while (folded.value) {
    lines = lines.filter(
      (line) =>
        !checkRangeOverlap(
          [folded.from, folded.to],
          [line.from, line.to],
        ),
    );
    folded.next();
  }

  return lines;
}
