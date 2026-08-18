import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { Client } from "../client.ts";
import { decoratorStateField, isCursorInRange } from "./util.ts";

class ResolveWidget extends WidgetType {
  constructor(
    readonly range: [number, number],
    readonly client: Client,
  ) {
    super();
  }

  toDOM() {
    const button = document.createElement("button");
    button.className = "sb-comment-resolve";
    button.textContent = "Resolve";
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const view = this.client.editorView;
      view.dispatch({
        changes: { ...resolveRange(view.state, this.range), insert: "" },
      });
    });
    return button;
  }

  override eq(other: ResolveWidget) {
    return other.range[0] === this.range[0] && other.range[1] === this.range[1];
  }

  override ignoreEvent() {
    return true;
  }
}

class CommentLabelWidget extends WidgetType {
  toDOM() {
    const label = document.createElement("span");
    label.className = "sb-comment-label";
    label.textContent = "comment";
    return label;
  }

  override eq() {
    return true;
  }
}

/**
 * The span Resolve deletes: the block's whole lines including the newline that
 * ends it, never a neighbour's. Deleting the *preceding* newline instead would
 * strand a blank first line when the block starts the document.
 */
export function resolveRange(
  state: EditorState,
  [from, to]: [number, number],
): { from: number; to: number } {
  return {
    from: state.doc.lineAt(from).from,
    to: Math.min(to + 1, state.doc.length),
  };
}

/** True when the marker is the only thing on its line. */
function markerOwnsLine(state: EditorState, from: number, to: number): boolean {
  const line = state.doc.lineAt(from);
  return line.from === from && line.to === to;
}

function decorateCommentRegions(state: EditorState, client: Client) {
  const decorations: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "CommentBlock") return;
      const range: [number, number] = [node.from, node.to];
      const markers = node.node.getChildren("CommentMarker");
      // An unclosed comment yields only its opening marker, and it runs to the
      // end of the document: mistaking that opener for the closer would put a
      // Resolve button on the line still being typed.
      const closer =
        markers.length > 1 ? markers[markers.length - 1] : undefined;
      // Markers are only hidden when they own their line: inline delimiters
      // (a one-liner) would drag the text sideways as the cursor moves. While
      // the comment is still unclosed nothing is hidden at all, or the `<!--`
      // just typed would vanish the moment the cursor moved away from it.
      const hideable = closer
        ? markers.filter((m) => markerOwnsLine(state, m.from, m.to))
        : [];
      const revealed = isCursorInRange(state, range);

      const firstLine = state.doc.lineAt(node.from).number;
      const lastLine = state.doc.lineAt(node.to).number;
      const closerOwnsLine =
        closer !== undefined && markerOwnsLine(state, closer.from, closer.to);
      const opener = markers[0];

      for (let n = firstLine; n <= lastLine; n++) {
        const classes = ["sb-comment-block"];
        if (n === firstLine) classes.push("sb-comment-block-first");
        if (n === lastLine) classes.push("sb-comment-block-last");
        decorations.push(
          Decoration.line({ class: classes.join(" ") }).range(
            state.doc.line(n).from,
          ),
        );
      }

      if (!revealed) {
        for (const marker of hideable) {
          decorations.push(
            Decoration.replace({}).range(marker.from, marker.to),
          );
        }
      }

      // Names the block in place of the `<!--` it replaced, the way frontmatter
      // does. Only where that marker is actually hidden: a one-liner and an
      // unclosed comment both keep theirs, so they already read as comments.
      if (!revealed && opener && hideable.includes(opener)) {
        decorations.push(
          Decoration.widget({
            widget: new CommentLabelWidget(),
            side: 1,
          }).range(opener.to),
        );
      }

      // On a one-liner the button would sit inline, right after the text.
      if (!state.readOnly && closer && closerOwnsLine) {
        decorations.push(
          Decoration.widget({
            widget: new ResolveWidget(range, client),
            side: 1,
          }).range(closer.to),
        );
      }
    },
  });
  return Decoration.set(decorations, true);
}

export function commentRegionPlugin(client: Client) {
  return decoratorStateField((state) => decorateCommentRegions(state, client));
}
