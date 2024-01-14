import { Client } from "../client.ts";
import {
  EditorView,
  foldAll,
  foldCode,
  toggleFold,
  Transaction,
  unfoldAll,
  unfoldCode,
  Vim,
  vimGetCm,
} from "../deps.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import type { FilterOption } from "../types.ts";
import { UploadFile } from "../../plug-api/types.ts";

export function editorSyscalls(editor: Client): SysCallMapping {
  const syscalls: SysCallMapping = {
    "editor.getCurrentPage": (): string => {
      return editor.currentPage!;
    },
    "editor.getText": () => {
      return editor.editorView.state.sliceDoc();
    },
    "editor.getCursor": (): number => {
      return editor.editorView.state.selection.main.from;
    },
    "editor.getSelection": (): { from: number; to: number } => {
      return editor.editorView.state.selection.main;
    },
    "editor.save": () => {
      return editor.save(true);
    },
    "editor.navigate": async (
      name: string,
      pos: number | string,
      replaceState = false,
      newWindow = false,
    ) => {
      await editor.navigate(name, pos, replaceState, newWindow);
    },
    "editor.reloadPage": async () => {
      await editor.reloadPage();
    },
    "editor.reloadUI": () => {
      location.reload();
    },
    "editor.openUrl": (url: string, existingWindow = false) => {
      if (!existingWindow) {
        const win = window.open(url, "_blank");
        if (win) {
          win.focus();
        }
      } else {
        location.href = url;
      }
    },
    "editor.downloadFile": (filename: string, dataUrl: string) => {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = filename;
      link.click();
    },
    "editor.uploadFile": (
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
      message: string,
      type: "error" | "info" = "info",
    ) => {
      editor.flashNotification(message, type);
    },
    "editor.filterBox": (
      label: string,
      options: FilterOption[],
      helpText = "",
      placeHolder = "",
    ): Promise<FilterOption | undefined> => {
      return editor.filterBox(label, options, helpText, placeHolder);
    },
    "editor.showPanel": (
      id: string,
      mode: number,
      html: string,
      script: string,
    ) => {
      editor.ui.viewDispatch({
        type: "show-panel",
        id: id as any,
        config: { html, script, mode },
      });
      setTimeout(() => {
        // Dummy dispatch to rerender the editor and toggle the panel
        editor.editorView.dispatch({});
      });
    },
    "editor.hidePanel": (id: string) => {
      editor.ui.viewDispatch({
        type: "hide-panel",
        id: id as any,
      });
      setTimeout(() => {
        // Dummy dispatch to rerender the editor and toggle the panel
        editor.editorView.dispatch({});
      });
    },
    "editor.insertAtPos": (text: string, pos: number) => {
      editor.editorView.dispatch({
        changes: {
          insert: text,
          from: pos,
        },
      });
    },
    "editor.replaceRange": (from: number, to: number, text: string) => {
      editor.editorView.dispatch({
        changes: {
          insert: text,
          from: from,
          to: to,
        },
      });
    },
    "editor.moveCursor": (pos: number, center = false) => {
      editor.editorView.dispatch({
        selection: {
          anchor: pos,
        },
      });
      if (center) {
        editor.editorView.dispatch({
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
      editor.editorView.focus();
    },
    "editor.setSelection": (from: number, to: number) => {
      editor.editorView.dispatch({
        selection: {
          anchor: from,
          head: to,
        },
      });
    },

    "editor.insertAtCursor": (text: string) => {
      const editorView = editor.editorView;
      const from = editorView.state.selection.main.from;
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
    "editor.dispatch": (change: Transaction) => {
      editor.editorView.dispatch(change);
    },
    "editor.prompt": (
      message: string,
      defaultValue = "",
    ): Promise<string | undefined> => {
      return editor.prompt(message, defaultValue);
    },
    "editor.confirm": (
      message: string,
    ): Promise<boolean> => {
      return editor.confirm(message);
    },
    "editor.getUiOption": (key: string): any => {
      return (editor.ui.viewState.uiOptions as any)[key];
    },
    "editor.setUiOption": (key: string, value: any) => {
      editor.ui.viewDispatch({
        type: "set-ui-option",
        key,
        value,
      });
    },
    "editor.vimEx": (exCommand: string) => {
      const cm = vimGetCm(editor.editorView)!;
      return Vim.handleEx(cm, exCommand);
    },
    // Folding
    "editor.fold": () => {
      foldCode(editor.editorView);
    },
    "editor.unfold": () => {
      unfoldCode(editor.editorView);
    },
    "editor.toggleFold": () => {
      toggleFold(editor.editorView);
    },
    "editor.foldAll": () => {
      foldAll(editor.editorView);
    },
    "editor.unfoldAll": () => {
      unfoldAll(editor.editorView);
    },
  };

  return syscalls;
}
