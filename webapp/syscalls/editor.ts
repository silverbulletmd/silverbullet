import { Editor } from "../editor";
import { syntaxTree } from "@codemirror/language";
import { Transaction } from "@codemirror/state";
import { SysCallMapping } from "../../plugos/system";

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

export default (editor: Editor): SysCallMapping => ({
  getCurrentPage: (): string => {
    return editor.currentPage!;
  },
  getText: () => {
    return editor.editorView?.state.sliceDoc();
  },
  getCursor: (): number => {
    return editor.editorView!.state.selection.main.from;
  },
  save: async () => {
    return editor.save(true);
  },
  navigate: async (ctx, name: string, pos: number) => {
    await editor.navigate(name, pos);
  },
  reloadPage: async (ctx) => {
    await editor.reloadPage();
  },
  openUrl: async (ctx, url: string) => {
    window.open(url, "_blank")!.focus();
  },
  flashNotification: (ctx, message: string) => {
    editor.flashNotification(message);
  },
  showRhs: (ctx, html: string) => {
    editor.viewDispatch({
      type: "show-rhs",
      html: html,
    });
  },
  insertAtPos: (ctx, text: string, pos: number) => {
    editor.editorView!.dispatch({
      changes: {
        insert: text,
        from: pos,
      },
    });
  },
  replaceRange: (ctx, from: number, to: number, text: string) => {
    editor.editorView!.dispatch({
      changes: {
        insert: text,
        from: from,
        to: to,
      },
    });
  },
  moveCursor: (ctx, pos: number) => {
    editor.editorView!.dispatch({
      selection: {
        anchor: pos,
      },
    });
  },
  insertAtCursor: (ctx, text: string) => {
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
  getSyntaxNodeUnderCursor: (): SyntaxNode | undefined => {
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
  getLineUnderCursor: (): string => {
    const editorState = editor.editorView!.state;
    let selection = editorState.selection.main;
    let line = editorState.doc.lineAt(selection.from);
    return editorState.sliceDoc(line.from, line.to);
  },
  matchBefore: (
    ctx,
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
  getSyntaxNodeAtPos: (ctx, pos: number): SyntaxNode | undefined => {
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
  dispatch: (ctx, change: Transaction) => {
    editor.editorView!.dispatch(change);
  },
  prompt: (ctx, message: string, defaultValue = ""): string | null => {
    return prompt(message, defaultValue);
  },
});
