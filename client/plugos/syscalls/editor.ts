import {
  acceptCompletion,
  closeCompletion,
  moveCompletionSelection,
  startCompletion,
} from "@codemirror/autocomplete";
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
  insertNewline,
  insertNewlineAndIndent,
  moveLineDown,
  moveLineUp,
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
  toggleComment,
  transposeChars,
  undo,
} from "@codemirror/commands";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import {
  foldAll,
  foldCode,
  toggleFold,
  unfoldAll,
  unfoldCode,
} from "@codemirror/language";
import { forceLinting } from "@codemirror/lint";
import { openSearchPanel } from "@codemirror/search";
import type { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  coerceAndValidateRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import type {
  FilterOption,
  NotificationAction,
  NotificationType,
  UploadFile,
} from "@silverbulletmd/silverbullet/type/client";
import type { VimConfig } from "@silverbulletmd/silverbullet/type/config";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { updateBakedSections } from "../../baked_sections/bake.ts";
import type { Client } from "../../client.ts";
import { refreshLintEffect } from "../../codemirror/lint.ts";
import { getVimModule } from "../../vim_loader.ts";
import type { SysCallMapping } from "../system.ts";

export function editorSyscalls(client: Client): SysCallMapping {
  const syscalls: SysCallMapping = {
    "editor.getCurrentPage": {
      callback: (): string => {
        return client.currentName();
      },
      description:
        "Returns the name of the page or document currently open in the editor.",
      returns: [{ type: "string", description: "The current page name." }],
    },
    "editor.getCurrentPageMeta": {
      callback: (): Promise<PageMeta | undefined> => {
        const name = client.currentName();
        return client.objectIndex.getObjectByRef(name, "page", name);
      },
      description:
        "Returns metadata for the page or document currently open in the editor.",
      returns: [
        {
          type: "PageMeta | undefined",
          description: "The current page metadata, if indexed.",
        },
      ],
    },
    "editor.getCurrentPath": {
      callback: (_ctx): string => {
        return client.currentPath();
      },
      description:
        "Returns the path of the page or document currently open in the editor.",
      returns: [{ type: "string", description: "The current page path." }],
    },
    "editor.getCurrentEditor": {
      callback: (): string => {
        return client.contentManager.documentEditor?.name || "page";
      },
      description:
        "Returns the name of the currently active editor implementation.",
      returns: [
        {
          type: "string",
          description: "The editor name, or `page` for the page editor.",
        },
      ],
    },
    "editor.getRecentlyOpenedPages": {
      callback: (): PageMeta[] => {
        return client.ui.viewState.allPages.sort(
          (a, b) => (b.lastOpened || 0) - (a.lastOpened || 0),
        );
      },
      description:
        "Returns page metadata ordered from most to least recently opened.",
      returns: [{ type: "PageMeta[]", description: "Recently opened pages." }],
    },
    "editor.getText": {
      callback: () => {
        return client.editorView.state.sliceDoc();
      },
      description:
        "Returns the full text of the currently open page or document.",
      returns: [{ type: "string", description: "The editor contents." }],
    },
    "editor.getCurrentLine": {
      callback: (): {
        from: number;
        to: number;
        text: string;
        textWithCursor: string;
      } => {
        const pos = client.editorView.state.selection.main.from;
        const line = client.editorView.state.doc.lineAt(pos);
        return {
          ...line,
          textWithCursor:
            line.text.slice(0, pos - line.from) +
            "|^|" +
            line.text.slice(pos - line.from),
        };
      },
      description:
        "Returns the current line's range and text, including a `|^|` cursor marker variant.",
      returns: [
        {
          type: "{ from: number; to: number; text: string; textWithCursor: string }",
          description: "The line containing the main selection head.",
        },
      ],
    },
    "editor.setText": {
      callback: (_ctx, newText: string, shouldIsolateHistory = false) => {
        client.contentManager.setEditorText(newText, shouldIsolateHistory);
      },
      description:
        "Updates the editor text with a minimal diff while preserving the cursor when possible.",
      parameters: [
        {
          name: "newText",
          type: "string",
          description: "The complete replacement text.",
        },
        {
          name: "shouldIsolateHistory",
          type: "boolean",
          description: "Whether to isolate the change in undo history.",
          optional: true,
        },
      ],
    },
    "editor.getCursor": {
      callback: (): number => {
        return client.editorView.state.selection.main.from;
      },
      description:
        "Returns the cursor position as a character offset from the start of the document.",
      returns: [{ type: "number", description: "The cursor offset." }],
    },
    "editor.getSelection": {
      callback: (): { from: number; to: number; text: string } => {
        const selection = client.editorView.state.selection.main;
        const text = client.editorView.state.sliceDoc(
          selection.from,
          selection.to,
        );
        return {
          from: selection.from,
          to: selection.to,
          text,
        };
      },
      description: "Returns the current selection range and selected text.",
      returns: [
        {
          type: "{ from: number; to: number; text: string }",
          description: "The main editor selection.",
        },
      ],
    },
    "editor.save": {
      callback: () => {
        return client.save(true);
      },
      description: "Forces the current page or document to be saved.",
    },
    "editor.navigate": {
      callback: async (
        _ctx,
        ref: Ref | string,
        replaceState = false,
        newWindow = false,
      ) => {
        await client.navigate(
          coerceAndValidateRef(ref),
          replaceState,
          newWindow,
        );
      },
      description:
        "Navigates to a page reference without restoring its remembered cursor and scroll position.",
      parameters: [
        {
          name: "ref",
          type: "Ref | string",
          description: "The page reference to navigate to.",
        },
        {
          name: "replaceState",
          type: "boolean",
          description: "Whether to replace the current browser history state.",
          optional: true,
        },
        {
          name: "newWindow",
          type: "boolean",
          description: "Whether to open the reference in a new window.",
          optional: true,
        },
      ],
      examples: [{ code: 'editor.navigate("CHANGELOG@123")' }],
    },
    "editor.open": {
      callback: async (
        _ctx,
        ref: Ref | string,
        replaceState = false,
        newWindow = false,
      ) => {
        await client.open(coerceAndValidateRef(ref), replaceState, newWindow);
      },
      description:
        "Opens a page reference and restores its remembered cursor and scroll position when possible.",
      parameters: [
        {
          name: "ref",
          type: "Ref | string",
          description: "The page reference to open.",
        },
        {
          name: "replaceState",
          type: "boolean",
          description: "Whether to replace the current browser history state.",
          optional: true,
        },
        {
          name: "newWindow",
          type: "boolean",
          description: "Whether to open the reference in a new window.",
          optional: true,
        },
      ],
      examples: [{ code: 'editor.open("CHANGELOG")' }],
    },
    "editor.reloadPage": {
      callback: async () => {
        await client.reloadEditor();
      },
      description: "Force reloads the current page in the editor.",
    },
    "editor.forceLint": {
      callback: () => {
        // `forceLinting` alone is a no-op on unchanged content after the
        // linter's internal "scheduled" flag has been cleared; the effect
        // re-arms it via `needsRefresh`.
        client.editorView.dispatch({
          effects: refreshLintEffect.of(null),
        });
        forceLinting(client.editorView);
      },
      description:
        "Forces editor linting to run, including when the content has not changed.",
    },
    "editor.reloadUI": {
      callback: () => {
        location.reload();
      },
      description: "Force reloads the browser UI.",
    },
    "editor.rebuildEditorState": {
      callback: () => {
        client.rebuildEditorState();
      },
      description:
        "Rebuilds the CodeMirror editor state from the current client configuration.",
    },
    "editor.reloadConfigAndCommands": {
      callback: async () => {
        await client.clientSystem.system.localSyscall("system.loadScripts", []);
        await client.clientSystem.system.localSyscall(
          "system.loadSpaceStyles",
          [],
        );
        client.rebuildEditorState();
      },
      description:
        "Reloads space scripts and styles, then rebuilds the editor state.",
    },
    "editor.invokeCommand": {
      callback: (_ctx, name: string, args?: string[]) => {
        return client.runCommandByName(name, args);
      },
      description: "Invokes a client command by name.",
      parameters: [
        { name: "name", type: "string", description: "The command name." },
        {
          name: "args",
          type: "string[]",
          description: "Arguments passed to the command.",
          optional: true,
        },
      ],
    },
    // Re-evaluate every baked section on the current page and rewrite each body
    // with its latest output (same as the "Baked Sections: Update" command),
    // exposed for programmatic use.
    "editor.updateBakedSections": {
      callback: (): Promise<void> => {
        return updateBakedSections(client);
      },
      description:
        "Re-evaluates every baked section on the current page and replaces each body with its latest output.",
    },
    "editor.openUrl": {
      callback: (_ctx, url: string, existingWindow = false) => {
        client.openUrl(url, existingWindow);
      },
      description: "Opens a URL in the browser.",
      parameters: [
        { name: "url", type: "string", description: "The URL to open." },
        {
          name: "existingWindow",
          type: "boolean",
          description: "Whether to reuse an existing window.",
          optional: true,
        },
      ],
    },
    "editor.newWindow": {
      callback: () => {
        globalThis.open(
          location.href,
          `rnd${Math.random()}`,
          `width=${globalThis.innerWidth},heigh=${globalThis.innerHeight}`,
        );
      },
      description:
        "Opens the current SilverBullet URL in a new browser window.",
    },
    "editor.goHistory": {
      callback: (_ctx, delta: number) => {
        globalThis.history.go(delta);
      },
      description: "Moves backward or forward through browser history.",
      parameters: [
        {
          name: "delta",
          type: "number",
          description:
            "The relative history offset; negative moves backward and positive moves forward.",
        },
      ],
    },
    "editor.downloadFile": {
      callback: (_ctx, filename: string, dataUrl: string) => {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = filename;
        link.click();
      },
      description:
        "Triggers a browser download of a data URL under the given filename.",
      parameters: [
        {
          name: "filename",
          type: "string",
          description: "The downloaded filename.",
        },
        {
          name: "dataUrl",
          type: "string",
          description: "The data URL to download.",
        },
      ],
      examples: [
        {
          code: 'editor.downloadFile("test.txt", "data:text/plain;base64,SGVsbG8=")',
        },
      ],
    },
    "editor.uploadFile": {
      callback: (
        _ctx,
        accept?: string,
        capture?: string,
      ): Promise<UploadFile> => {
        return new Promise<UploadFile>((resolve, reject) => {
          const input = document.createElement("input");
          input.type = "file";
          if (accept) {
            input.accept = accept;
          }
          if (capture) {
            input.capture = capture;
          }

          input.onchange = () => {
            const file = input.files?.item(0);
            if (!file) {
              reject(new Error("No file found"));
            } else {
              const reader = new FileReader();
              reader.readAsArrayBuffer(file);
              reader.onloadend = async (evt) => {
                if (evt.target?.readyState === FileReader.DONE) {
                  resolve({
                    name: file.name,
                    contentType: file.type,
                    content: new Uint8Array(await file.arrayBuffer()),
                  });
                }
              };
              reader.onabort = (e) => {
                reject(e);
              };
              reader.onerror = (e) => {
                reject(e);
              };
            }
          };
          input.onabort = (e) => {
            reject(e);
          };

          input.style.display = "none";
          document.body.appendChild(input);
          input.click();
          setTimeout(() => document.body.removeChild(input), 1000);
        });
      },
      description:
        "Opens the browser's native file picker and returns the selected file's bytes and metadata.",
      parameters: [
        {
          name: "accept",
          type: "string",
          description: "Accepted file types for the file input.",
          optional: true,
        },
        {
          name: "capture",
          type: "string",
          description: "The media capture mode for the file input.",
          optional: true,
        },
      ],
      returns: [
        {
          type: "UploadFile",
          description: "The selected file's name, content type, and bytes.",
        },
      ],
      examples: [
        {
          code: 'local file = editor.uploadFile(".txt")\nprint(file.name)',
        },
      ],
    },
    "editor.flashNotification": {
      callback: (
        _ctx,
        message: string,
        type: NotificationType = "info",
        options?: { timeout?: number; actions?: NotificationAction[] },
      ) => {
        client.ui.flashNotification(message, type, options);
      },
      description: "Shows a flash notification in the editor UI.",
      parameters: [
        {
          name: "message",
          type: "string",
          description: "The message to display.",
        },
        {
          name: "type",
          type: "NotificationType",
          description:
            'The notification severity: "info", "error", or "warning".',
          optional: true,
        },
        {
          name: "options",
          type: "{ timeout?: number; actions?: NotificationAction[] }",
          description:
            "Optional timeout and action buttons. A timeout of 0 keeps the notification visible until dismissed.",
          optional: true,
        },
      ],
      examples: [
        {
          code: 'editor.flashNotification("Update available", "warning", {\n  timeout = 0,\n  actions = {{\n    name = "Reload",\n    run = function() editor.reloadUI() end\n  }}\n})',
        },
      ],
    },
    "editor.filterBox": {
      callback: (
        _ctx,
        label: string,
        options: FilterOption[],
        helpText = "",
        placeHolder = "",
      ): Promise<FilterOption | undefined> => {
        return client.ui.filterBox(label, options, helpText, placeHolder);
      },
      description:
        "Shows a filterable option picker similar to the page navigator.",
      parameters: [
        {
          name: "label",
          type: "string",
          description: "The label shown beside the filter input.",
        },
        {
          name: "options",
          type: "FilterOption[]",
          description: "The available options.",
        },
        {
          name: "helpText",
          type: "string",
          description: "Help text shown below the picker.",
          optional: true,
        },
        {
          name: "placeHolder",
          type: "string",
          description: "Placeholder text for the filter input.",
          optional: true,
        },
      ],
      returns: [
        {
          type: "FilterOption | undefined",
          description: "The selected option, or undefined if dismissed.",
        },
      ],
      examples: [
        {
          code: 'local result = editor.filterBox("Select:", {\n  {name = "Option 1", value = "1"},\n  {name = "Option 2", value = "2", description = "More details"}\n})',
        },
      ],
    },
    "editor.showPanel": {
      callback: (
        _ctx,
        id: string,
        mode: number,
        html: HTMLElement | HTMLElement[] | string,
        script: string,
      ) => {
        client.ui.viewDispatch({
          type: "show-panel",
          id: id as any,
          config: { html, script, mode },
        });
        setTimeout(() => {
          // Dummy dispatch to rerender the editor and toggle the panel
          client.editorView.dispatch({});
        });
      },
      description: "Shows an HTML panel in a specified editor UI location.",
      parameters: [
        {
          name: "id",
          type: "string",
          description: "The panel location identifier.",
        },
        {
          name: "mode",
          type: "number",
          description: "The panel display mode or size.",
        },
        {
          name: "html",
          type: "HTMLElement | HTMLElement[] | string",
          description: "The panel content.",
        },
        {
          name: "script",
          type: "string",
          description: "A script associated with the panel content.",
        },
      ],
    },
    "editor.focus": {
      callback: () => {
        client.focus();
      },
      description: "Returns focus to the main editor.",
    },
    "editor.hidePanel": {
      callback: (_ctx, id: string) => {
        client.ui.viewDispatch({
          type: "hide-panel",
          id: id as any,
        });
        setTimeout(() => {
          // Dummy dispatch to rerender the editor and toggle the panel
          client.editorView.dispatch({});
        });
      },
      description: "Hides the panel at a specified editor UI location.",
      parameters: [
        {
          name: "id",
          type: "string",
          description: "The panel location identifier.",
        },
      ],
    },
    "editor.showProgress": {
      callback: (
        _ctx,
        progressPercentage?: number,
        progressType?: "sync" | "index",
      ) => {
        client.ui.showProgress(progressPercentage, progressType);
      },
      description:
        "Shows, updates, or hides a sync or indexing progress indicator.",
      parameters: [
        {
          name: "progressPercentage",
          type: "number",
          description:
            "Completion percentage, or undefined to hide the indicator.",
          optional: true,
        },
        {
          name: "progressType",
          type: "sync | index",
          description: "The operation represented by the indicator.",
          optional: true,
        },
      ],
    },
    "editor.insertAtPos": {
      callback: (
        _ctx,
        text: string,
        pos: number,
        cursorPlaceHolder = false,
      ) => {
        let cursorPlaceholderPos = -1;
        if (cursorPlaceHolder) {
          cursorPlaceholderPos = text.indexOf("|^|");
          if (cursorPlaceholderPos !== -1) {
            text =
              text.slice(0, cursorPlaceholderPos) +
              text.slice(cursorPlaceholderPos + 3);
          } else {
            cursorPlaceHolder = false;
          }
        }
        client.editorView.dispatch({
          changes: {
            insert: text,
            from: pos,
          },
        });
        if (cursorPlaceHolder) {
          const cursorPos = pos + cursorPlaceholderPos;
          client.editorView.dispatch({
            selection: {
              anchor: cursorPos,
            },
            effects: [EditorView.scrollIntoView(cursorPos)],
          });
        }
      },
      description:
        "Inserts text at a character offset, optionally placing the cursor at a `|^|` marker.",
      parameters: [
        { name: "text", type: "string", description: "The text to insert." },
        {
          name: "pos",
          type: "number",
          description: "The character offset at which to insert.",
        },
        {
          name: "cursorPlaceHolder",
          type: "boolean",
          description:
            "Whether to remove `|^|` and move the cursor to its position.",
          optional: true,
        },
      ],
    },
    "editor.replaceRange": {
      callback: (
        _ctx,
        from: number,
        to: number,
        text: string,
        cursorPlaceHolder = false,
      ) => {
        let cursorPlaceholderPos = -1;
        if (cursorPlaceHolder) {
          cursorPlaceholderPos = text.indexOf("|^|");
          text =
            text.slice(0, cursorPlaceholderPos) +
            text.slice(cursorPlaceholderPos + 3);
        }
        client.editorView.dispatch({
          changes: {
            insert: text,
            from: from,
            to: to,
          },
        });
        if (cursorPlaceHolder) {
          const cursorPos = from + cursorPlaceholderPos;
          client.editorView.dispatch({
            selection: {
              anchor: cursorPos,
            },
            effects: [EditorView.scrollIntoView(cursorPos)],
          });
        }
      },
      description:
        "Replaces a text range, optionally placing the cursor at a `|^|` marker in the replacement.",
      parameters: [
        {
          name: "from",
          type: "number",
          description: "The start offset of the range.",
        },
        {
          name: "to",
          type: "number",
          description: "The end offset of the range.",
        },
        {
          name: "text",
          type: "string",
          description: "The replacement text.",
        },
        {
          name: "cursorPlaceHolder",
          type: "boolean",
          description:
            "Whether to remove `|^|` and move the cursor to its position.",
          optional: true,
        },
      ],
    },
    "editor.moveCursor": {
      callback: (_ctx, pos: number, center = false) => {
        // Always scroll into view so callers don't strand the cursor
        // off-screen; `nearest` (default) is a no-op when already visible.
        client.editorView.dispatch({
          selection: { anchor: pos },
          effects: [
            EditorView.scrollIntoView(pos, center ? { y: "center" } : {}),
          ],
        });
        client.editorView.focus();
      },
      description:
        "Moves and focuses the cursor at a character offset, scrolling it into view.",
      parameters: [
        {
          name: "pos",
          type: "number",
          description: "The character offset to move to.",
        },
        {
          name: "center",
          type: "boolean",
          description: "Whether to vertically center the cursor.",
          optional: true,
        },
      ],
    },
    "editor.moveCursorToLine": {
      callback: (_ctx, line: number, column = 1, center = false) => {
        // CodeMirror already keeps information about lines
        const cmLine = client.editorView.state.doc.line(line);
        // How much to move inside the line, column number starts from 1
        const offset = Math.max(0, Math.min(cmLine.length, column - 1));
        // Just reuse the implementation above
        const moveCursor = syscalls["editor.moveCursor"];
        const moveCursorCallback =
          typeof moveCursor === "function" ? moveCursor : moveCursor.callback;
        moveCursorCallback(_ctx, cmLine.from + offset, center);
      },
      description:
        "Moves the cursor to a one-based line and column, clamping the column to the line length.",
      parameters: [
        {
          name: "line",
          type: "number",
          description: "The one-based line number.",
        },
        {
          name: "column",
          type: "number",
          description: "The one-based column number.",
          optional: true,
        },
        {
          name: "center",
          type: "boolean",
          description: "Whether to vertically center the cursor.",
          optional: true,
        },
      ],
    },
    "editor.setSelection": {
      callback: (_ctx, from: number, to: number) => {
        client.editorView.dispatch({
          selection: {
            anchor: from,
            head: to,
          },
        });
      },
      description: "Sets the main editor selection to a character range.",
      parameters: [
        {
          name: "from",
          type: "number",
          description: "The selection anchor offset.",
        },
        {
          name: "to",
          type: "number",
          description: "The selection head offset.",
        },
      ],
    },

    "editor.insertAtCursor": {
      callback: (
        _ctx,
        text: string,
        scrollIntoView = false,
        cursorPlaceHolder = false,
      ) => {
        const editorView = client.editorView;
        const from = editorView.state.selection.main.from;
        const cursorPlaceholderPos = text.indexOf("|^|");
        if (cursorPlaceHolder && cursorPlaceholderPos !== -1) {
          text =
            text.slice(0, cursorPlaceholderPos) +
            text.slice(cursorPlaceholderPos + 3);
        } else {
          cursorPlaceHolder = false;
        }
        editorView.dispatch({
          changes: {
            insert: text,
            from: from,
          },
          selection: {
            anchor: cursorPlaceHolder
              ? from + cursorPlaceholderPos
              : from + text.length,
          },
          scrollIntoView,
        });
      },
      description:
        "Inserts text at the cursor and moves the cursor after it or to an optional `|^|` marker.",
      parameters: [
        { name: "text", type: "string", description: "The text to insert." },
        {
          name: "scrollIntoView",
          type: "boolean",
          description: "Whether to scroll the new cursor position into view.",
          optional: true,
        },
        {
          name: "cursorPlaceHolder",
          type: "boolean",
          description:
            "Whether to remove `|^|` and move the cursor to its position.",
          optional: true,
        },
      ],
    },
    "editor.dispatch": {
      callback: (_ctx, change: Transaction) => {
        client.editorView.dispatch(change);
      },
      description: "Dispatches a CodeMirror transaction to the editor view.",
      parameters: [
        {
          name: "change",
          type: "Transaction",
          description: "The CodeMirror transaction to dispatch.",
        },
      ],
    },
    "editor.prompt": {
      callback: (
        _ctx,
        message: string,
        defaultValue = "",
      ): Promise<string | undefined> => {
        return client.ui.prompt(message, defaultValue);
      },
      description: "Prompts the user for text input.",
      parameters: [
        {
          name: "message",
          type: "string",
          description: "The prompt message.",
        },
        {
          name: "defaultValue",
          type: "string",
          description: "The initial input value.",
          optional: true,
        },
      ],
      returns: [
        {
          type: "string | undefined",
          description: "The entered text, or undefined if dismissed.",
        },
      ],
    },
    "editor.confirm": {
      callback: (
        _ctx,
        message: string,
        options?: { destructive?: boolean },
      ): Promise<boolean> => {
        return client.ui.confirm(message, options);
      },
      description: "Prompts the user to confirm or cancel an action.",
      parameters: [
        {
          name: "message",
          type: "string",
          description: "The confirmation message.",
        },
        {
          name: "options",
          type: "{ destructive?: boolean }",
          description: "Optional dialog styling settings.",
          optional: true,
        },
      ],
      returns: [
        { type: "boolean", description: "Whether the user confirmed." },
      ],
    },
    "editor.alert": {
      callback: (_ctx, message: string) => {
        alert(message);
      },
      description: "Shows a browser alert dialog.",
      parameters: [
        {
          name: "message",
          type: "string",
          description: "The alert message.",
        },
      ],
    },
    "editor.getUiOption": {
      callback: (_ctx, key: string): any => {
        return (client.ui.viewState.uiOptions as any)[key];
      },
      description: "Returns the current value of an editor UI option.",
      parameters: [
        { name: "key", type: "string", description: "The UI option key." },
      ],
      returns: [{ type: "any", description: "The option value." }],
    },
    "editor.setUiOption": {
      callback: (_ctx, key: string, value: any) => {
        client.ui.viewDispatch({
          type: "set-ui-option",
          key,
          value,
        });
        void client.reloadEditor();
      },
      description: "Sets an editor UI option and reloads the editor.",
      parameters: [
        { name: "key", type: "string", description: "The UI option key." },
        { name: "value", type: "any", description: "The option value." },
      ],
    },
    "editor.vimEx": {
      callback: (_ctx, exCommand: string) => {
        const vimMod = getVimModule();
        if (!vimMod) {
          throw new Error("Vim module not loaded.");
        }
        const cm = vimMod.getCM(client.editorView);
        if (cm?.state.vim) {
          return vimMod.Vim.handleEx(cm as any, exCommand);
        } else {
          throw new Error("Vim mode not active or not initialized.");
        }
      },
      description: "Executes a Vim Ex command in the active Vim-mode editor.",
      parameters: [
        {
          name: "exCommand",
          type: "string",
          description: "The Ex command to execute.",
        },
      ],
    },
    "editor.configureVimMode": {
      callback: () => {
        const vimMod = getVimModule();
        if (!vimMod) {
          throw new Error("Vim module not loaded.");
        }
        const { Vim } = vimMod;
        // Override the default "o" binding to be more intelligent and follow the markdown editor's behavior
        Vim.mapCommand("o", "action", "newline-continue-markup", {}, {});
        Vim.mapCommand("O", "action", "back-newline-continue-markup", {}, {});
        Vim.unmap("<C-q>", undefined as any);
        Vim.defineAction("newline-continue-markup", (cm) => {
          // Append at end of line
          Vim.handleKey(cm, "A", "+input");
          // Insert newline continuing markup where appropriate
          insertNewlineContinueMarkup(client.editorView) ||
            insertNewlineAndIndent(client.editorView);
        });
        Vim.defineAction("back-newline-continue-markup", (cm) => {
          // Determine current line
          const pos = client.editorView.state.selection.main.from;
          const line = client.editorView.state.doc.lineAt(pos).number;
          if (line === 1) {
            // We're on the top line
            // Go to 0:0
            Vim.handleKey(cm, "0", "+input");
            // Insert a newline
            insertNewline(client.editorView);
            // Go up to the new line
            Vim.handleKey(cm, "k", "+input");
            // Into insert mode
            Vim.handleKey(cm, "i", "+input");
          } else {
            // We're elsewhere in the document
            // Go up
            Vim.handleKey(cm, "k", "+input");
            // Append mode at the end of the line
            Vim.handleKey(cm, "A", "+input");
            // Insert a newline using the continue markup thing
            insertNewlineContinueMarkup(client.editorView) ||
              insertNewlineAndIndent(client.editorView);
          }
        });

        // Load the config if any
        const config = client.config.get<VimConfig>("vim", {});
        if (config) {
          config.unmap?.forEach((binding) => {
            if (typeof binding === "string") {
              console.log(`Unmapping ${binding}`);
              // @ts-expect-error: unmap expects a string for the mode, this is problematic with Ex mappings which requires undefined or false
              Vim.unmap(binding, undefined);
            } else if (binding.key) {
              console.log(
                `Unmapping ${binding.key} in ${binding.mode ?? "normal"}`,
              );
              Vim.unmap(binding.key, binding.mode ?? "normal");
            }
          });
          config.map?.forEach(({ map, to, mode }) => {
            console.log(`Mapping ${map} to ${to} for ${mode ?? "normal"}`);
            Vim.map(map, to, mode ?? "normal");
          });
          config.noremap?.forEach(({ map, to, mode }) => {
            console.log(`Noremapping ${map} to ${to} for ${mode ?? "normal"}`);
            Vim.noremap(map, to, mode ?? "normal");
          });
          config.commands?.forEach(({ ex, command }) => {
            console.log(`Mapping command '${command}' to Ex ${ex}`);
            Vim.defineEx(ex, "", (_, params) =>
              client.runCommandByName(command, params.args),
            );
          });
        } else {
          console.log("No vim config found");
        }
      },
      description:
        "Configures CodeMirror Vim mode from the current SilverBullet Vim settings.",
    },
    "editor.openPageNavigator": {
      callback: (_ctx, mode: "page" | "meta" | "document" | "all" = "page") => {
        client.startPageNavigate(mode);
      },
      description: "Opens the page navigator in the requested browsing mode.",
      parameters: [
        {
          name: "mode",
          type: "page | meta | document | all",
          description: "The navigator mode.",
          optional: true,
        },
      ],
    },
    "editor.openCommandPalette": {
      callback: () => {
        void client.startCommandPalette();
      },
      description: "Opens the command palette.",
    },
    "editor.deleteLine": {
      callback: () => {
        deleteLine(client.editorView);
      },
      description:
        "Deletes the current line or the lines touched by the selection.",
    },
    "editor.selectAll": {
      callback: () => {
        return selectAll({
          state: client.editorView.state,
          dispatch: client.editorView.dispatch,
        });
      },
      description: "Selects the entire editor document.",
    },
    "editor.indentMore": {
      callback: () => {
        return indentMore({
          state: client.editorView.state,
          dispatch: client.editorView.dispatch,
        });
      },
      description: "Increases indentation for the current line or selection.",
    },
    "editor.indentLess": {
      callback: () => {
        return indentLess({
          state: client.editorView.state,
          dispatch: client.editorView.dispatch,
        });
      },
      description: "Decreases indentation for the current line or selection.",
    },
    "editor.toggleComment": {
      callback: () => {
        return toggleComment({
          state: client.editorView.state,
          dispatch: client.editorView.dispatch,
        });
      },
      description: "Comments or uncomments the current line or selection.",
    },
    "editor.moveLineUp": {
      callback: () => {
        return moveLineUp({
          state: client.editorView.state,
          dispatch: client.editorView.dispatch,
        });
      },
      description: "Moves the current line or selected lines upward.",
    },
    "editor.moveLineDown": {
      callback: () => {
        return moveLineDown({
          state: client.editorView.state,
          dispatch: client.editorView.dispatch,
        });
      },
      description: "Moves the current line or selected lines downward.",
    },
    // Folding
    "editor.fold": {
      callback: () => {
        foldCode(client.editorView);
      },
      description: "Folds the code or markup region at the cursor.",
    },
    "editor.unfold": {
      callback: () => {
        unfoldCode(client.editorView);
      },
      description: "Unfolds the folded region at the cursor.",
    },
    "editor.toggleFold": {
      callback: () => {
        toggleFold(client.editorView);
      },
      description: "Toggles folding for the region at the cursor.",
    },
    "editor.foldAll": {
      callback: () => {
        foldAll(client.editorView);
      },
      description: "Folds all foldable regions in the editor.",
    },
    "editor.unfoldAll": {
      callback: () => {
        unfoldAll(client.editorView);
      },
      description: "Unfolds all folded regions in the editor.",
    },
    "editor.undo": {
      callback: () => {
        return undo(client.editorView);
      },
      description: "Undoes the most recent editor change.",
    },
    "editor.redo": {
      callback: () => {
        return redo(client.editorView);
      },
      description: "Redoes the most recently undone editor change.",
    },
    // Cursor motion syscalls
    "editor.cursorCharLeft": {
      callback: () => cursorCharLeft(client.editorView),
      description:
        "Moves the cursor one character left, respecting bidirectional text.",
    },
    "editor.cursorCharRight": {
      callback: () => cursorCharRight(client.editorView),
      description:
        "Moves the cursor one character right, respecting bidirectional text.",
    },
    "editor.cursorGroupLeft": {
      callback: () => cursorGroupLeft(client.editorView),
      description: "Moves the cursor left by one character group or word.",
    },
    "editor.cursorGroupRight": {
      callback: () => cursorGroupRight(client.editorView),
      description: "Moves the cursor right by one character group or word.",
    },
    "editor.cursorLineBoundaryLeft": {
      callback: () => cursorLineBoundaryLeft(client.editorView),
      description:
        "Moves the cursor to the left visual boundary of the current line.",
    },
    "editor.cursorLineBoundaryRight": {
      callback: () => cursorLineBoundaryRight(client.editorView),
      description:
        "Moves the cursor to the right visual boundary of the current line.",
    },
    "editor.cursorLineStart": {
      callback: () => cursorLineStart(client.editorView),
      description: "Moves the cursor to the start of the current logical line.",
    },
    "editor.cursorLineEnd": {
      callback: () => cursorLineEnd(client.editorView),
      description: "Moves the cursor to the end of the current logical line.",
    },
    "editor.cursorDocStart": {
      callback: () => cursorDocStart(client.editorView),
      description: "Moves the cursor to the start of the document.",
    },
    "editor.cursorDocEnd": {
      callback: () => cursorDocEnd(client.editorView),
      description: "Moves the cursor to the end of the document.",
    },
    // Cursor motions that also navigate the completion popup if it's open
    "editor.cursorLineUp": {
      callback: () => {
        const view = client.editorView;
        if (moveCompletionSelection(false)(view)) return true;
        return cursorLineUp(view);
      },
      description:
        "Moves completion selection up when open, otherwise moves the cursor up one visual line.",
    },
    "editor.cursorLineDown": {
      callback: () => {
        const view = client.editorView;
        if (moveCompletionSelection(true)(view)) return true;
        return cursorLineDown(view);
      },
      description:
        "Moves completion selection down when open, otherwise moves the cursor down one visual line.",
    },
    "editor.cursorPageUp": {
      callback: () => {
        const view = client.editorView;
        if (moveCompletionSelection(false, "page")(view)) return true;
        return cursorPageUp(view);
      },
      description:
        "Moves completion selection up one page when open, otherwise moves the cursor up one viewport page.",
    },
    "editor.cursorPageDown": {
      callback: () => {
        const view = client.editorView;
        if (moveCompletionSelection(true, "page")(view)) return true;
        return cursorPageDown(view);
      },
      description:
        "Moves completion selection down one page when open, otherwise moves the cursor down one viewport page.",
    },
    // Selection-extending motions
    "editor.selectCharLeft": {
      callback: () => selectCharLeft(client.editorView),
      description:
        "Extends the selection one character left, respecting bidirectional text.",
    },
    "editor.selectCharRight": {
      callback: () => selectCharRight(client.editorView),
      description:
        "Extends the selection one character right, respecting bidirectional text.",
    },
    "editor.selectGroupLeft": {
      callback: () => selectGroupLeft(client.editorView),
      description: "Extends the selection left by one character group or word.",
    },
    "editor.selectGroupRight": {
      callback: () => selectGroupRight(client.editorView),
      description:
        "Extends the selection right by one character group or word.",
    },
    "editor.selectLineBoundaryLeft": {
      callback: () => selectLineBoundaryLeft(client.editorView),
      description:
        "Extends the selection to the left visual boundary of the current line.",
    },
    "editor.selectLineBoundaryRight": {
      callback: () => selectLineBoundaryRight(client.editorView),
      description:
        "Extends the selection to the right visual boundary of the current line.",
    },
    "editor.selectLineStart": {
      callback: () => selectLineStart(client.editorView),
      description:
        "Extends the selection to the start of the current logical line.",
    },
    "editor.selectLineEnd": {
      callback: () => selectLineEnd(client.editorView),
      description:
        "Extends the selection to the end of the current logical line.",
    },
    "editor.selectDocStart": {
      callback: () => selectDocStart(client.editorView),
      description: "Extends the selection to the start of the document.",
    },
    "editor.selectDocEnd": {
      callback: () => selectDocEnd(client.editorView),
      description: "Extends the selection to the end of the document.",
    },
    "editor.selectLineUp": {
      callback: () => selectLineUp(client.editorView),
      description: "Extends the selection upward by one visual line.",
    },
    "editor.selectLineDown": {
      callback: () => selectLineDown(client.editorView),
      description: "Extends the selection downward by one visual line.",
    },
    "editor.selectPageUp": {
      callback: () => selectPageUp(client.editorView),
      description: "Extends the selection upward by one viewport page.",
    },
    "editor.selectPageDown": {
      callback: () => selectPageDown(client.editorView),
      description: "Extends the selection downward by one viewport page.",
    },
    // Delete
    "editor.deleteCharBackward": {
      callback: () => deleteCharBackward(client.editorView),
      description: "Deletes the selection or the character before the cursor.",
    },
    "editor.deleteCharForward": {
      callback: () => deleteCharForward(client.editorView),
      description: "Deletes the selection or the character after the cursor.",
    },
    "editor.deleteGroupBackward": {
      callback: () => deleteGroupBackward(client.editorView),
      description:
        "Deletes the selection or the character group before the cursor.",
    },
    "editor.deleteGroupForward": {
      callback: () => deleteGroupForward(client.editorView),
      description:
        "Deletes the selection or the character group after the cursor.",
    },
    "editor.deleteLineBoundaryBackward": {
      callback: () => deleteLineBoundaryBackward(client.editorView),
      description:
        "Deletes the selection or text back to the current line boundary.",
    },
    "editor.deleteLineBoundaryForward": {
      callback: () => deleteLineBoundaryForward(client.editorView),
      description:
        "Deletes the selection or text forward to the current line boundary.",
    },
    "editor.transposeChars": {
      callback: () => transposeChars(client.editorView),
      description: "Transposes the characters around the cursor.",
    },
    // Enter: accept completion if popup is open, else newline-and-indent
    "editor.insertNewline": {
      callback: () => {
        const view = client.editorView;
        if (acceptCompletion(view)) return true;
        return insertNewlineAndIndent(view);
      },
      description:
        "Accepts the active completion, or inserts a newline with appropriate indentation.",
    },
    // Completion popup control
    "editor.acceptCompletion": {
      callback: () => acceptCompletion(client.editorView),
      description:
        "Accepts the currently selected completion when the completion popup is active.",
      returns: [
        {
          type: "boolean",
          description: "Whether an active completion was accepted.",
        },
      ],
    },
    "editor.startCompletion": {
      callback: () => startCompletion(client.editorView),
      description: "Explicitly starts editor completion at the cursor.",
    },
    "editor.closeCompletion": {
      callback: () => closeCompletion(client.editorView),
      description: "Closes the active editor completion popup.",
    },
    "editor.openSearchPanel": {
      callback: () => {
        openSearchPanel(client.editorView);
      },
      description: "Opens the editor's native search panel.",
    },
    "editor.copyToClipboard": {
      callback: async (_ctx, data: string | Blob) => {
        try {
          if (typeof data === "string") {
            await navigator.clipboard.writeText(data);
          } else {
            await navigator.clipboard.write([
              new ClipboardItem({ [data.type]: data }),
            ]);
          }
        } catch (e) {
          console.error(e);
          client.ui.flashNotification(`Could not copy to clipboard: ${e}`);
        }
      },
      description:
        "Copies text or binary Blob data to the system clipboard. Clipboard access requires a secure HTTPS context.",
      parameters: [
        {
          name: "data",
          type: "string | Blob",
          description: "The text or Blob to copy.",
        },
      ],
      examples: [{ code: 'editor.copyToClipboard("Copied text")' }],
    },
    "editor.sendMessage": {
      callback: (_ctx, type: string, data: any) => {
        if (!client.contentManager.isDocumentEditor()) return;

        client.contentManager.documentEditor.sendPublicMessage({
          type,
          data,
        });
      },
      description:
        "Sends a public message to the active document editor, if one is open.",
      parameters: [
        { name: "type", type: "string", description: "The message type." },
        {
          name: "data",
          type: "any",
          description: "Data attached to the message.",
          optional: true,
        },
      ],
    },

    "editor.isMobile": {
      callback: () => {
        const mouseDetected = globalThis.matchMedia("(pointer:fine)").matches;
        return !mouseDetected;
      },
      description:
        "Checks whether the current device lacks a fine pointer and should be treated as mobile.",
      returns: [
        {
          type: "boolean",
          description:
            "Whether the editor is running in a mobile-style pointer environment.",
        },
      ],
    },
  };

  return syscalls;
}
