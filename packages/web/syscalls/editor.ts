import { Editor } from "../editor";
import { Transaction } from "@codemirror/state";
import { SysCallMapping } from "@plugos/plugos/system";
import { FilterOption } from "@silverbulletmd/common/types";

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

export function editorSyscalls(editor: Editor): SysCallMapping {
  return {
    "editor.getCurrentPage": (): string => {
      return editor.currentPage!;
    },
    // sets the current page name, without changing the content
    "editor.setPage": (ctx, newName: string) => {
      return editor.viewDispatch({
        type: "page-loaded",
        name: newName,
      });
    },
    "editor.getText": () => {
      return editor.editorView?.state.sliceDoc();
    },
    "editor.getCursor": (): number => {
      return editor.editorView!.state.selection.main.from;
    },
    "editor.save": async () => {
      return editor.save(true);
    },
    "editor.navigate": async (ctx, name: string, pos: number) => {
      await editor.navigate(name, pos);
    },
    "editor.reloadPage": async (ctx) => {
      await editor.reloadPage();
    },
    "editor.openUrl": async (ctx, url: string) => {
      let win = window.open(url, "_blank");
      if (win) {
        win.focus();
      }
    },
    "editor.flashNotification": (ctx, message: string) => {
      editor.flashNotification(message);
    },
    "editor.filterBox": (
      ctx,
      label: string,
      options: FilterOption[],
      helpText: string = "",
      placeHolder: string = ""
    ): Promise<FilterOption | undefined> => {
      return editor.filterBox(label, options, helpText, placeHolder);
    },
    "editor.showRhs": (ctx, html: string, flex: number) => {
      editor.viewDispatch({
        type: "show-rhs",
        flex,
        html,
      });
    },
    "editor.hideRhs": (ctx) => {
      editor.viewDispatch({
        type: "hide-rhs",
      });
    },
    "editor.showLhs": (ctx, html: string, flex: number) => {
      editor.viewDispatch({
        type: "show-lhs",
        flex,
        html,
      });
    },
    "editor.hideLhs": (ctx) => {
      editor.viewDispatch({
        type: "hide-lhs",
      });
    },
    "editor.showBhs": (ctx, html: string, flex: number) => {
      editor.viewDispatch({
        type: "show-bhs",
        flex,
        html,
      });
    },
    "editor.hideBhs": (ctx) => {
      editor.viewDispatch({
        type: "hide-bhs",
      });
    },
    "editor.insertAtPos": (ctx, text: string, pos: number) => {
      editor.editorView!.dispatch({
        changes: {
          insert: text,
          from: pos,
        },
      });
    },
    "editor.replaceRange": (ctx, from: number, to: number, text: string) => {
      editor.editorView!.dispatch({
        changes: {
          insert: text,
          from: from,
          to: to,
        },
      });
    },
    "editor.moveCursor": (ctx, pos: number) => {
      editor.editorView!.dispatch({
        selection: {
          anchor: pos,
        },
      });
    },
    "editor.insertAtCursor": (ctx, text: string) => {
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

    "editor.matchBefore": (
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
    "editor.dispatch": (ctx, change: Transaction) => {
      editor.editorView!.dispatch(change);
    },
    "editor.prompt": (
      ctx,
      message: string,
      defaultValue = ""
    ): string | null => {
      return prompt(message, defaultValue);
    },
  };
}
