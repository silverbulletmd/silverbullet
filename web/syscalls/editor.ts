import { Editor } from "../editor.tsx";
import { Transaction } from "../../dep_web.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import { FilterOption } from "../../common/types.ts";

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
      : "",
  );
}

export function editorSyscalls(editor: Editor): SysCallMapping {
  const syscalls: SysCallMapping = {
    "editor.getCurrentPage": (): string => {
      return editor.currentPage!;
    },
    "editor.getText": () => {
      return editor.editorView?.state.sliceDoc();
    },
    "editor.getCursor": (): number => {
      return editor.editorView!.state.selection.main.from;
    },
    "editor.getSelection": (): { from: number; to: number } => {
      return editor.editorView!.state.selection.main;
    },
    "editor.save": async () => {
      return editor.save(true);
    },
    "editor.navigate": async (
      ctx,
      name: string,
      pos: number | string,
      replaceState = false,
    ) => {
      await editor.navigate(name, pos, replaceState);
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
    "editor.flashNotification": (
      ctx,
      message: string,
      type: "error" | "info" = "info",
    ) => {
      editor.flashNotification(message, type);
    },
    "editor.filterBox": (
      ctx,
      label: string,
      options: FilterOption[],
      helpText: string = "",
      placeHolder: string = "",
    ): Promise<FilterOption | undefined> => {
      return editor.filterBox(label, options, helpText, placeHolder);
    },
    "editor.showPanel": (
      ctx,
      id: string,
      mode: number,
      html: string,
      script: string,
    ) => {
      editor.viewDispatch({
        type: "show-panel",
        id: id as any,
        config: { html, script, mode },
      });
    },
    "editor.hidePanel": (ctx, id: string) => {
      editor.viewDispatch({
        type: "hide-panel",
        id: id as any,
      });
    },
    // Deprecated in favor of using "hidePanel" and "showPanel"
    "editor.showRhs": (ctx, html: string, script: string, flex: number) => {
      syscalls["editor.showPanel"](ctx, "rhs", flex, html, script);
    },
    "editor.hideRhs": (ctx) => {
      syscalls["editor.hidePanel"](ctx, "rhs");
    },
    "editor.showLhs": (ctx, html: string, script: string, flex: number) => {
      syscalls["editor.showPanel"](ctx, "lhs", flex, html, script);
    },
    "editor.hideLhs": (ctx) => {
      syscalls["editor.hidePanel"](ctx, "lhs");
    },
    "editor.showBhs": (ctx, html: string, script: string, flex: number) => {
      syscalls["editor.showPanel"](ctx, "bhs", flex, html, script);
    },
    "editor.hideBhs": (ctx) => {
      syscalls["editor.hidePanel"](ctx, "bhs");
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
    "editor.setSelection": (ctx, from: number, to: number) => {
      let editorView = editor.editorView!;
      editorView.dispatch({
        selection: {
          anchor: from,
          head: to,
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
      regexp: string,
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
      defaultValue = "",
    ): string | null => {
      return prompt(message, defaultValue);
    },
    "editor.enableReadOnlyMode": (ctx, enabled: boolean) => {
      editor.viewDispatch({
        type: "set-editor-ro",
        enabled,
      });
    },
  };

  return syscalls;
}
