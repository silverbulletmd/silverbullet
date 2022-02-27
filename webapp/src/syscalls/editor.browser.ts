import { Editor } from "../editor";
import { syntaxTree } from "@codemirror/language";
import { Transaction } from "@codemirror/state";

type SyntaxNode = {
  name: string;
  text: string;
  from: number;
  to: number;
};

function ensureAnchor(expr: any, start: boolean) {
  var _a;
  let { source } = expr;
  let addStart = start && source[0] != "^",
    addEnd = source[source.length - 1] != "$";
  if (!addStart && !addEnd) return expr;
  return new RegExp(
    `${addStart ? "^" : ""}(?:${source})${addEnd ? "$" : ""}`,
    (_a = expr.flags) !== null && _a !== void 0
      ? _a
      : expr.ignoreCase
      ? "i"
      : ""
  );
}

export default (editor: Editor) => ({
  "editor.getText": () => {
    return editor.editorView?.state.sliceDoc();
  },
  "editor.getCursor": (): number => {
    return editor.editorView!.state.selection.main.from;
  },
  "editor.navigate": async (name: string) => {
    await editor.navigate(name);
  },
  "editor.insertAtPos": (text: string, pos: number) => {
    editor.editorView!.dispatch({
      changes: {
        insert: text,
        from: pos,
      },
    });
  },
  "editor.replaceRange": (from: number, to: number, text: string) => {
    editor.editorView!.dispatch({
      changes: {
        insert: text,
        from: from,
        to: to,
      },
    });
  },
  "editor.moveCursor": (pos: number) => {
    editor.editorView!.dispatch({
      selection: {
        anchor: pos,
      },
    });
  },
  "editor.insertAtCursor": (text: string) => {
    let editorView = editor.editorView!;
    let from = editorView.state.selection.main.from;
    editorView.dispatch({
      changes: {
        insert: text,
        from: from,
      },
      selection: {
        anchor: from + text.length,
      },
    });
  },
  "editor.getSyntaxNodeUnderCursor": (): SyntaxNode | undefined => {
    const editorState = editor.editorView!.state;
    let selection = editorState.selection.main;
    if (selection.empty) {
      let node = syntaxTree(editorState).resolveInner(selection.from);
      if (node) {
        return {
          name: node.name,
          text: editorState.sliceDoc(node.from, node.to),
          from: node.from,
          to: node.to,
        };
      }
    }
  },
  "editor.matchBefore": (
    regexp: string
  ): { from: number; to: number; text: string } | null => {
    const editorState = editor.editorView!.state;
    let selection = editorState.selection.main;
    let from = selection.from;
    if (selection.empty) {
      let line = editorState.doc.lineAt(from);
      let start = Math.max(line.from, from - 250);
      let str = line.text.slice(start - line.from, from - line.from);
      let found = str.search(ensureAnchor(new RegExp(regexp), false));
      // console.log("Line", line, start, str, new RegExp(regexp), found);
      return found < 0
        ? null
        : { from: start + found, to: from, text: str.slice(found) };
    }
    return null;
  },
  "editor.getSyntaxNodeAtPos": (pos: number): SyntaxNode | undefined => {
    const editorState = editor.editorView!.state;
    let node = syntaxTree(editorState).resolveInner(pos);
    if (node) {
      return {
        name: node.name,
        text: editorState.sliceDoc(node.from, node.to),
        from: node.from,
        to: node.to,
      };
    }
  },
  "editor.dispatch": (change: Transaction) => {
    editor.editorView!.dispatch(change);
  },
});
