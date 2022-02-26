import { Editor } from "../editor";
import { SyscallContext } from "../plugins/runtime";
import { syntaxTree } from "@codemirror/language";

export default (editor: Editor) => ({
  "editor.getText": (ctx: SyscallContext) => {
    return editor.editorView?.state.sliceDoc();
  },
  "editor.getCursor": (ctx: SyscallContext): number => {
    return editor.editorView!.state.selection.main.from;
  },
  "editor.navigate": async (ctx: SyscallContext, name: string) => {
    await editor.navigate(name);
  },
  "editor.insertAtPos": (ctx: SyscallContext, text: string, pos: number) => {
    editor.editorView!.dispatch({
      changes: {
        insert: text,
        from: pos,
      },
    });
  },
  "editor.replaceRange": (
    ctx: SyscallContext,
    from: number,
    to: number,
    text: string
  ) => {
    editor.editorView!.dispatch({
      changes: {
        insert: text,
        from: from,
        to: to,
      },
    });
  },
  "editor.moveCursor": (ctx: SyscallContext, pos: number) => {
    editor.editorView!.dispatch({
      selection: {
        anchor: pos,
      },
    });
  },
  "editor.insertAtCursor": (ctx: SyscallContext, text: string) => {
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
  "editor.getSyntaxNodeUnderCursor": (
    ctx: SyscallContext
  ): { name: string; text: string } | undefined => {
    const editorState = editor.editorView!.state;
    let selection = editorState.selection.main;
    if (selection.empty) {
      let node = syntaxTree(editorState).resolveInner(selection.from);
      if (node) {
        return {
          name: node.name,
          text: editorState.sliceDoc(node.from, node.to),
        };
      }
    }
  },
  "editor.getSyntaxNodeAtPos": (
    ctx: SyscallContext,
    pos: number
  ): { name: string; text: string } | undefined => {
    const editorState = editor.editorView!.state;
    let node = syntaxTree(editorState).resolveInner(pos);
    if (node) {
      return {
        name: node.name,
        text: editorState.sliceDoc(node.from, node.to),
      };
    }
  },
});
