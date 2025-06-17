import type { Client } from "../client.ts";
import {
  foldAll,
  foldCode,
  toggleFold,
  unfoldAll,
  unfoldCode,
} from "@codemirror/language";
import {
  deleteLine,
  insertNewline,
  insertNewlineAndIndent,
  moveLineDown,
  moveLineUp,
  redo,
  undo,
} from "@codemirror/commands";
import type { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM as vimGetCm, Vim } from "@replit/codemirror-vim";
import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type {
  FilterOption,
  UploadFile,
} from "@silverbulletmd/silverbullet/type/client";
import { openSearchPanel } from "@codemirror/search";
import { parseRef, type Ref } from "@silverbulletmd/silverbullet/lib/page_ref";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import type { VimConfig } from "../../type/config.ts";
import type { PageMeta } from "../../type/index.ts";

export function editorSyscalls(client: Client): SysCallMapping {
  const syscalls: SysCallMapping = {
    "editor.getCurrentPage": (): string => {
      return client.currentPage;
    },
    "editor.getCurrentPageMeta": (): PageMeta | undefined => {
      return client.ui.viewState.current?.meta;
    },
    "editor.getCurrentPath": (_ctx, extension: boolean): string => {
      return client.currentPath(extension);
    },
    "editor.getCurrentEditor": (): string => {
      return client.documentEditor?.name || "page";
    },
    "editor.getRecentlyOpenedPages": (): PageMeta[] => {
      return client.ui.viewState.allPages.sort((a, b) =>
        (b.lastOpened || 0) - (a.lastOpened || 0)
      );
    },
    "editor.getText": () => {
      return client.editorView.state.sliceDoc();
    },
    "editor.getCurrentLine": (): {
      from: number;
      to: number;
      text: string;
      textWithCursor: string;
    } => {
      const pos = client.editorView.state.selection.main.from;
      const line = client.editorView.state.doc.lineAt(pos);
      return {
        ...line,
        textWithCursor: line.text.slice(0, pos - line.from) + "|^|" +
          line.text.slice(pos - line.from),
      };
    },
    "editor.setText": (_ctx, newText: string, shouldIsolateHistory = false) => {
      client.setEditorText(newText, shouldIsolateHistory);
    },
    "editor.getCursor": (): number => {
      return client.editorView.state.selection.main.from;
    },
    "editor.getSelection": (): { from: number; to: number; text: string } => {
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
    "editor.save": () => {
      return client.save(true);
    },
    "editor.navigate": async (
      _ctx,
      ref: Ref | string,
      replaceState = false,
      newWindow = false,
    ) => {
      if (typeof ref === "string") {
        ref = parseRef(ref);
      } else if (ref.kind === undefined) {
        ref.kind = "page";
      }
      await client.navigate(ref, replaceState, newWindow);
    },
    "editor.reloadPage": async () => {
      await client.reloadPage();
    },
    "editor.reloadUI": () => {
      location.reload();
    },
    "editor.rebuildEditorState": () => {
      client.rebuildEditorState();
    },
    "editor.reloadConfigAndCommands": async () => {
      await client.clientSystem.system.localSyscall(
        "system.loadScripts",
        [],
      );
      await client.clientSystem.system.localSyscall(
        "system.loadSpaceStyles",
        [],
      );
    },
    "editor.invokeCommand": (_ctx, name: string, args?: string[]) => {
      return client.runCommandByName(name, args);
    },
    "editor.openUrl": (_ctx, url: string, existingWindow = false) => {
      client.openUrl(url, existingWindow);
    },
    "editor.newWindow": () => {
      globalThis.open(
        location.href,
        "rnd" + Math.random(),
        `width=${globalThis.innerWidth},heigh=${globalThis.innerHeight}`,
      );
    },
    "editor.goHistory": (_ctx, delta: number) => {
      globalThis.history.go(delta);
    },
    "editor.downloadFile": (_ctx, filename: string, dataUrl: string) => {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = filename;
      link.click();
    },
    "editor.uploadFile": (
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
              if (evt.target?.readyState == FileReader.DONE) {
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

        input.click();
      });
    },
    "editor.flashNotification": (
      _ctx,
      message: string,
      type: "error" | "info" = "info",
    ) => {
      client.flashNotification(message, type);
    },
    "editor.filterBox": (
      _ctx,
      label: string,
      options: FilterOption[],
      helpText = "",
      placeHolder = "",
    ): Promise<FilterOption | undefined> => {
      return client.filterBox(label, options, helpText, placeHolder);
    },
    "editor.showPanel": (
      _ctx,
      id: string,
      mode: number,
      html: string,
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
    "editor.hidePanel": (_ctx, id: string) => {
      client.ui.viewDispatch({
        type: "hide-panel",
        id: id as any,
      });
      setTimeout(() => {
        // Dummy dispatch to rerender the editor and toggle the panel
        client.editorView.dispatch({});
      });
    },
    "editor.showProgress": (
      _ctx,
      progressPercentage?: number,
      progressType?: "sync" | "index",
    ) => {
      client.showProgress(progressPercentage, progressType);
    },
    "editor.insertAtPos": (
      _ctx,
      text: string,
      pos: number,
      cursorPlaceHolder = false,
    ) => {
      let cursorPlaceholderPos = -1;
      if (cursorPlaceHolder) {
        cursorPlaceholderPos = text.indexOf("|^|");
        if (cursorPlaceholderPos !== -1) {
          text = text.slice(0, cursorPlaceholderPos) +
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
          effects: [
            EditorView.scrollIntoView(cursorPos),
          ],
        });
      }
    },
    "editor.replaceRange": (
      _ctx,
      from: number,
      to: number,
      text: string,
      cursorPlaceHolder = false,
    ) => {
      let cursorPlaceholderPos = -1;
      if (cursorPlaceHolder) {
        cursorPlaceholderPos = text.indexOf("|^|");
        text = text.slice(0, cursorPlaceholderPos) +
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
          effects: [
            EditorView.scrollIntoView(cursorPos),
          ],
        });
      }
    },
    "editor.moveCursor": (_ctx, pos: number, center = false) => {
      client.editorView.dispatch({
        selection: {
          anchor: pos,
        },
      });
      if (center) {
        client.editorView.dispatch({
          effects: [
            EditorView.scrollIntoView(
              pos,
              {
                y: "center",
              },
            ),
          ],
        });
      }
      client.editorView.focus();
    },
    "editor.moveCursorToLine": (
      _ctx,
      line: number,
      column = 1,
      center = false,
    ) => {
      // CodeMirror already keeps information about lines
      const cmLine = client.editorView.state.doc.line(line);
      // How much to move inside the line, column number starts from 1
      const offset = Math.max(0, Math.min(cmLine.length, column - 1));
      // Just reuse the implementation above
      syscalls["editor.moveCursor"](_ctx, cmLine.from + offset, center);
    },
    "editor.setSelection": (_ctx, from: number, to: number) => {
      client.editorView.dispatch({
        selection: {
          anchor: from,
          head: to,
        },
      });
    },

    "editor.insertAtCursor": (
      _ctx,
      text: string,
      scrollIntoView = false,
      cursorPlaceHolder = false,
    ) => {
      const editorView = client.editorView;
      const from = editorView.state.selection.main.from;
      const cursorPlaceholderPos = text.indexOf("|^|");
      if (cursorPlaceHolder && cursorPlaceholderPos !== -1) {
        text = text.slice(0, cursorPlaceholderPos) +
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
    "editor.dispatch": (_ctx, change: Transaction) => {
      client.editorView.dispatch(change);
    },
    "editor.prompt": (
      _ctx,
      message: string,
      defaultValue = "",
    ): Promise<string | undefined> => {
      return client.prompt(message, defaultValue);
    },
    "editor.confirm": (_ctx, message: string): Promise<boolean> => {
      return client.confirm(message);
    },
    "editor.alert": (_ctx, message: string) => {
      alert(message);
    },
    "editor.getUiOption": (_ctx, key: string): any => {
      return (client.ui.viewState.uiOptions as any)[key];
    },
    "editor.setUiOption": (_ctx, key: string, value: any) => {
      client.ui.viewDispatch({
        type: "set-ui-option",
        key,
        value,
      });
      client.reloadPage();
    },
    "editor.vimEx": (_ctx, exCommand: string) => {
      const cm = vimGetCm(client.editorView);
      if (cm && cm.state.vim) {
        return Vim.handleEx(cm as any, exCommand);
      } else {
        throw new Error("Vim mode not active or not initialized.");
      }
    },
    "editor.configureVimMode": () => {
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
            console.log("Unmapping " + binding);
            // @ts-ignore: unmap expects a string for the mode, this is problematic with Ex mappings which requires undefined or false
            Vim.unmap(binding, undefined);
          } else if (binding.key) {
            console.log(
              "Unmapping " + binding.key + " in " + (binding.mode ?? "normal"),
            );
            Vim.unmap(binding.key, binding.mode ?? "normal");
          }
        });
        config.map?.forEach(({ map, to, mode }) => {
          console.log(
            "Mapping " + map + " to " + to + " for " + (mode ?? "normal"),
          );
          Vim.map(map, to, mode ?? "normal");
        });
        config.noremap?.forEach(({ map, to, mode }) => {
          console.log(
            "Noremapping " + map + " to " + to + " for " + (mode ?? "normal"),
          );
          Vim.noremap(map, to, mode ?? "normal");
        });
        config.commands?.forEach(({ ex, command }) => {
          console.log("Mapping command '" + command + "' to Ex " + ex);
          Vim.defineEx(ex, "", () => client.runCommandByName(command));
        });
      } else {
        console.log("No vim config found");
      }
    },
    "editor.openPageNavigator": (
      _ctx,
      mode: "page" | "meta" | "document" | "all" = "page",
    ) => {
      client.startPageNavigate(mode);
    },
    "editor.openCommandPalette": () => {
      client.ui.viewDispatch({
        type: "show-palette",
        context: client.getContext(),
      });
    },
    "editor.deleteLine": () => {
      deleteLine(client.editorView);
    },
    "editor.moveLineUp": () => {
      return moveLineUp({
        state: client.editorView.state,
        dispatch: client.editorView.dispatch,
      });
    },
    "editor.moveLineDown": () => {
      return moveLineDown({
        state: client.editorView.state,
        dispatch: client.editorView.dispatch,
      });
    },
    // Folding
    "editor.fold": () => {
      foldCode(client.editorView);
    },
    "editor.unfold": () => {
      unfoldCode(client.editorView);
    },
    "editor.toggleFold": () => {
      toggleFold(client.editorView);
    },
    "editor.foldAll": () => {
      foldAll(client.editorView);
    },
    "editor.unfoldAll": () => {
      unfoldAll(client.editorView);
    },
    "editor.undo": () => {
      return undo(client.editorView);
    },
    "editor.redo": () => {
      return redo(client.editorView);
    },
    "editor.openSearchPanel": () => {
      openSearchPanel(client.editorView);
    },
    "editor.copyToClipboard": (_ctx, data: string | Blob) => {
      if (typeof data === "string") {
        navigator.clipboard.writeText(data);
      } else {
        navigator.clipboard.write([new ClipboardItem({ [data.type]: data })]);
      }
    },
    "editor.sendMessage": (_ctx, type: string, data: any) => {
      if (!client.isDocumentEditor()) return;

      client.documentEditor.sendPublicMessage({
        type,
        data,
      });
    },
  };

  return syscalls;
}
