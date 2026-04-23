import {
  cursorCharLeft,
  cursorCharRight,
  cursorDocEnd,
  cursorDocStart,
  cursorGroupLeft,
  cursorGroupRight,
  cursorLineBoundaryLeft,
  cursorLineBoundaryRight,
  cursorLineDown,
  cursorLineEnd,
  cursorLineStart,
  cursorLineUp,
  cursorPageDown,
  cursorPageUp,
  deleteCharBackward,
  deleteCharForward,
  deleteGroupBackward,
  deleteGroupForward,
  deleteLine,
  deleteLineBoundaryBackward,
  deleteLineBoundaryForward,
  indentLess,
  indentMore,
  insertNewlineAndIndent,
  redo,
  selectAll,
  selectCharLeft,
  selectCharRight,
  selectDocEnd,
  selectDocStart,
  selectGroupLeft,
  selectGroupRight,
  selectLineBoundaryLeft,
  selectLineBoundaryRight,
  selectLineDown,
  selectLineEnd,
  selectLineStart,
  selectLineUp,
  selectPageDown,
  selectPageUp,
  transposeChars,
  undo,
} from "@codemirror/commands";
import {
  acceptCompletion,
  closeCompletion,
  moveCompletionSelection,
  startCompletion,
} from "@codemirror/autocomplete";
import { openSearchPanel } from "@codemirror/search";
import { reloadAllWidgets } from "./codemirror/code_widget.ts";
import { broadcastReload } from "./components/widget_sandbox_iframe.ts";
import type { Client } from "./client.ts";
import type { CommandHook } from "./plugos/hooks/command.ts";

/**
 * Registers client-side editor commands with the CommandHook. These were
 * previously defined in the editor plug; moving them into the client makes
 * them synchronous (no async round-trip through the plug Web Worker) and
 * avoids losing key events when the user types faster than the worker
 * responds. They are still exposed through the official command mechanism
 * so Lua scripts can rebind them.
 *
 * The `hook` is passed explicitly because this runs from inside the
 * `ClientSystem` constructor, before `client.clientSystem` has been assigned.
 */
export function registerEditorCommands(
  client: Client,
  hook: CommandHook,
): void {
  const view = () => client.editorView;

  // Enter: accept completion if popup is open, else newline-and-indent
  hook.registerCommand({
    name: "Editor: Insert Newline",
    key: "Enter",
    mac: "Enter",
    requireMode: "rw",
    requireEditor: "page",
    disableInVim: true,
    run: async () => {
      const v = view();
      if (acceptCompletion(v)) return true;
      return insertNewlineAndIndent(v);
    },
  });

  // Delete
  hook.registerCommand({
    name: "Editor: Delete Char Backward",
    key: ["Backspace", "Ctrl-h"],
    mac: ["Backspace", "Ctrl-h"],
    requireMode: "rw",
    requireEditor: "page",
    disableInVim: true,
    run: async () => deleteCharBackward(view()),
  });
  hook.registerCommand({
    name: "Editor: Delete Char Forward",
    key: "Delete",
    mac: "Delete",
    requireMode: "rw",
    requireEditor: "page",
    disableInVim: true,
    run: async () => deleteCharForward(view()),
  });
  hook.registerCommand({
    name: "Editor: Delete Group Backward",
    key: "Ctrl-Backspace",
    mac: "Alt-Backspace",
    requireMode: "rw",
    requireEditor: "page",
    disableInVim: true,
    run: async () => deleteGroupBackward(view()),
  });
  hook.registerCommand({
    name: "Editor: Delete Group Forward",
    key: "Ctrl-Delete",
    mac: "Alt-Delete",
    requireMode: "rw",
    requireEditor: "page",
    disableInVim: true,
    run: async () => deleteGroupForward(view()),
  });
  hook.registerCommand({
    name: "Editor: Delete Line Boundary Backward",
    mac: "Cmd-Backspace",
    requireMode: "rw",
    requireEditor: "page",
    disableInVim: true,
    run: async () => deleteLineBoundaryBackward(view()),
  });
  hook.registerCommand({
    name: "Editor: Delete Line Boundary Forward",
    mac: "Cmd-Delete",
    requireMode: "rw",
    requireEditor: "page",
    disableInVim: true,
    run: async () => deleteLineBoundaryForward(view()),
  });
  hook.registerCommand({
    name: "Editor: Transpose Chars",
    key: "Ctrl-t",
    mac: "Ctrl-t",
    requireMode: "rw",
    requireEditor: "page",
    disableInVim: true,
    run: async () => transposeChars(view()),
  });

  // Cursor motions
  hook.registerCommand({
    name: "Editor: Cursor Char Left",
    key: "ArrowLeft",
    requireEditor: "page",
    disableInVim: true,
    run: async () => cursorCharLeft(view()),
  });
  hook.registerCommand({
    name: "Editor: Cursor Char Right",
    key: "ArrowRight",
    requireEditor: "page",
    disableInVim: true,
    run: async () => cursorCharRight(view()),
  });
  hook.registerCommand({
    name: "Editor: Cursor Group Left",
    key: "Ctrl-ArrowLeft",
    mac: "Alt-ArrowLeft",
    requireEditor: "page",
    disableInVim: true,
    run: async () => cursorGroupLeft(view()),
  });
  hook.registerCommand({
    name: "Editor: Cursor Group Right",
    key: "Ctrl-ArrowRight",
    mac: "Alt-ArrowRight",
    requireEditor: "page",
    disableInVim: true,
    run: async () => cursorGroupRight(view()),
  });
  hook.registerCommand({
    name: "Editor: Cursor Line Boundary Left",
    mac: "Cmd-ArrowLeft",
    requireEditor: "page",
    disableInVim: true,
    run: async () => cursorLineBoundaryLeft(view()),
  });
  hook.registerCommand({
    name: "Editor: Cursor Line Boundary Right",
    mac: "Cmd-ArrowRight",
    requireEditor: "page",
    disableInVim: true,
    run: async () => cursorLineBoundaryRight(view()),
  });
  hook.registerCommand({
    name: "Editor: Cursor Line Start",
    key: "Home",
    requireEditor: "page",
    disableInVim: true,
    run: async () => cursorLineStart(view()),
  });
  hook.registerCommand({
    name: "Editor: Cursor Line End",
    key: ["End", "Ctrl-e"],
    mac: ["End", "Ctrl-e"],
    requireEditor: "page",
    disableInVim: true,
    run: async () => cursorLineEnd(view()),
  });
  hook.registerCommand({
    name: "Editor: Cursor Doc Start",
    key: "Ctrl-Home",
    mac: ["Ctrl-Home", "Cmd-ArrowUp"],
    requireEditor: "page",
    disableInVim: true,
    run: async () => cursorDocStart(view()),
  });
  hook.registerCommand({
    name: "Editor: Cursor Doc End",
    key: "Ctrl-End",
    mac: ["Ctrl-End", "Cmd-ArrowDown"],
    requireEditor: "page",
    disableInVim: true,
    run: async () => cursorDocEnd(view()),
  });
  hook.registerCommand({
    name: "Editor: Cursor Line Up",
    key: ["ArrowUp", "Ctrl-p"],
    mac: "ArrowUp",
    requireEditor: "page",
    disableInVim: true,
    run: async () => {
      const v = view();
      if (moveCompletionSelection(false)(v)) return true;
      return cursorLineUp(v);
    },
  });
  hook.registerCommand({
    name: "Editor: Cursor Line Down",
    key: "ArrowDown",
    mac: "ArrowDown",
    requireEditor: "page",
    disableInVim: true,
    run: async () => {
      const v = view();
      if (moveCompletionSelection(true)(v)) return true;
      return cursorLineDown(v);
    },
  });
  hook.registerCommand({
    name: "Editor: Cursor Page Up",
    key: "PageUp",
    mac: ["PageUp", "Ctrl-ArrowUp"],
    requireEditor: "page",
    disableInVim: true,
    run: async () => {
      const v = view();
      if (moveCompletionSelection(false, "page")(v)) return true;
      return cursorPageUp(v);
    },
  });
  hook.registerCommand({
    name: "Editor: Cursor Page Down",
    key: "PageDown",
    mac: ["PageDown", "Ctrl-v", "Ctrl-ArrowDown"],
    requireEditor: "page",
    disableInVim: true,
    run: async () => {
      const v = view();
      if (moveCompletionSelection(true, "page")(v)) return true;
      return cursorPageDown(v);
    },
  });

  // Selection-extending motions
  hook.registerCommand({
    name: "Editor: Select Char Left",
    key: "Shift-ArrowLeft",
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectCharLeft(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Char Right",
    key: "Shift-ArrowRight",
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectCharRight(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Group Left",
    key: "Shift-Ctrl-ArrowLeft",
    mac: "Shift-Alt-ArrowLeft",
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectGroupLeft(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Group Right",
    key: "Shift-Ctrl-ArrowRight",
    mac: "Shift-Alt-ArrowRight",
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectGroupRight(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Line Boundary Left",
    mac: "Shift-Cmd-ArrowLeft",
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectLineBoundaryLeft(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Line Boundary Right",
    mac: "Shift-Cmd-ArrowRight",
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectLineBoundaryRight(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Line Start",
    key: "Shift-Home",
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectLineStart(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Line End",
    key: ["Shift-End", "Shift-Ctrl-e"],
    mac: ["Shift-End", "Shift-Ctrl-e"],
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectLineEnd(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Doc Start",
    key: "Shift-Ctrl-Home",
    mac: ["Shift-Ctrl-Home", "Shift-Cmd-ArrowUp"],
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectDocStart(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Doc End",
    key: "Shift-Ctrl-End",
    mac: ["Shift-Ctrl-End", "Shift-Cmd-ArrowDown"],
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectDocEnd(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Line Up",
    key: ["Shift-ArrowUp", "Shift-Ctrl-p"],
    mac: "Shift-ArrowUp",
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectLineUp(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Line Down",
    key: "Shift-ArrowDown",
    mac: "Shift-ArrowDown",
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectLineDown(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Page Up",
    key: "Shift-PageUp",
    mac: ["Shift-PageUp", "Shift-Ctrl-ArrowUp"],
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectPageUp(view()),
  });
  hook.registerCommand({
    name: "Editor: Select Page Down",
    key: "Shift-PageDown",
    mac: ["Shift-PageDown", "Shift-Ctrl-ArrowDown"],
    requireEditor: "page",
    disableInVim: true,
    run: async () => selectPageDown(view()),
  });

  // Selection / indentation
  hook.registerCommand({
    name: "Editor: Select All",
    key: "Ctrl-a",
    mac: "Cmd-a",
    requireEditor: "page",
    disableInVim: true,
    run: async () => {
      const v = view();
      return selectAll({ state: v.state, dispatch: v.dispatch });
    },
  });
  hook.registerCommand({
    name: "Editor: Indent",
    key: "Tab",
    mac: "Tab",
    requireMode: "rw",
    requireEditor: "page",
    run: async () => {
      const v = view();
      // Accept completion popup suggestion if open, else indent
      if (acceptCompletion(v)) return true;
      return indentMore({ state: v.state, dispatch: v.dispatch });
    },
  });
  hook.registerCommand({
    name: "Editor: Outdent",
    key: "Shift-Tab",
    mac: "Shift-Tab",
    requireMode: "rw",
    requireEditor: "page",
    run: async () => {
      const v = view();
      return indentLess({ state: v.state, dispatch: v.dispatch });
    },
  });

  // Undo / redo
  hook.registerCommand({
    name: "Editor: Undo",
    key: "Ctrl-z",
    mac: "Cmd-z",
    requireMode: "rw",
    requireEditor: "page",
    menu: { location: "edit", group: "1_undo", order: 1, label: "Undo" },
    run: async () => undo(view()),
  });
  hook.registerCommand({
    name: "Editor: Redo",
    key: "Ctrl-y",
    mac: "Cmd-Shift-z",
    requireMode: "rw",
    requireEditor: "page",
    menu: { location: "edit", group: "1_undo", order: 2, label: "Redo" },
    run: async () => redo(view()),
  });

  // Delete line
  hook.registerCommand({
    name: "Delete Line",
    key: "Ctrl-d",
    requireMode: "rw",
    requireEditor: "page",
    run: async () => deleteLine(view()),
  });

  // Completion popup
  hook.registerCommand({
    name: "Editor: Start Completion",
    key: "Ctrl-Space",
    requireEditor: "page",
    disableInVim: true,
    run: async () => startCompletion(view()),
  });
  hook.registerCommand({
    name: "Editor: Close Completion",
    key: "Escape",
    requireEditor: "page",
    disableInVim: true,
    run: async () => closeCompletion(view()),
  });

  // Openers (modal UI — not in the typing hot path, but moving them out of
  // the plug removes an unnecessary worker round-trip).
  hook.registerCommand({
    name: "Open Command Palette",
    key: "Ctrl-/",
    mac: "Cmd-/",
    menu: { location: "file", group: "3_palette", label: "Command Palette..." },
    run: async () => client.startCommandPalette(),
  });
  hook.registerCommand({
    name: "Navigate: Page Picker",
    key: "Ctrl-k",
    mac: "Cmd-k",
    menu: [
      { location: "file", group: "1_new", order: 2, label: "Open Page..." },
      { location: "navigate", group: "2_picker", order: 1, label: "Page..." },
    ],
    run: async () => client.startPageNavigate("page"),
  });
  hook.registerCommand({
    name: "Navigate: Meta Picker",
    key: "Ctrl-Shift-k",
    mac: "Cmd-Shift-k",
    menu: { location: "navigate", group: "2_picker", order: 4, label: "Meta Page..." },
    run: async () => client.startPageNavigate("meta"),
  });
  hook.registerCommand({
    name: "Navigate: Document Picker",
    key: "Ctrl-o",
    mac: "Cmd-o",
    menu: [
      { location: "file", group: "1_new", order: 3, label: "Open Document..." },
      { location: "navigate", group: "2_picker", order: 2, label: "Document..." },
    ],
    run: async () => client.startPageNavigate("document"),
  });
  hook.registerCommand({
    name: "Navigate: Anything Picker",
    run: async () => client.startPageNavigate("all"),
  });
  hook.registerCommand({
    name: "Editor: Find in Page",
    key: "Ctrl-f",
    mac: "Cmd-f",
    requireEditor: "page",
    menu: { location: "edit", group: "3_find", label: "Find in Page..." },
    run: async () => {
      openSearchPanel(view());
      return false; // keep focus on search panel, not the editor
    },
  });
  hook.registerCommand({
    name: "Editor: New Window",
    key: "Ctrl-n",
    mac: "Cmd-n",
    run: async () => {
      globalThis.open(
        location.href,
        `rnd${Math.random()}`,
        `width=${globalThis.innerWidth},heigh=${globalThis.innerHeight}`,
      );
    },
  });
  hook.registerCommand({
    name: "Widgets: Refresh All",
    requireEditor: "page",
    run: async () => {
      broadcastReload();
      return reloadAllWidgets();
    },
  });
}
