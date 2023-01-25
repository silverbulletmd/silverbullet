import { app, Menu, MenuItemConstructorOptions, shell } from "electron";
import { findInstanceByUrl, newWindow, openFolderPicker } from "./instance";
import { newWindowState } from "./store";
import os from "node:os";

const template: MenuItemConstructorOptions[] = [
  {
    label: "File",
    role: "fileMenu",
    submenu: [
      {
        label: "New Window",
        accelerator: "CommandOrControl+N",
        click: (_item, win) => {
          const url = new URL(win.webContents.getURL());
          const instance = findInstanceByUrl(url);
          if (instance) {
            newWindow(instance, newWindowState(instance.folder));
          }
        },
      },
      {
        label: "Open Space",
        accelerator: "CommandOrControl+Shift+O",
        click: () => {
          openFolderPicker();
        },
      },
      os.platform() === "darwin"
        ? {
          role: "recentDocuments",
          submenu: [
            {
              role: "clearRecentDocuments",
            },
          ],
        }
        : undefined,
      { type: "separator" },
      {
        label: "Quit",
        accelerator: "CommandOrControl+Q",
        role: "quit",
      },
    ],
  },
  {
    label: "Edit",
    role: "editMenu",
    submenu: [
      {
        label: "Undo",
        accelerator: "CommandOrControl+Z",
        role: "undo",
      },
      {
        label: "Redo",
        accelerator: "Shift+CommandOrControl+Z",
        role: "redo",
      },
      { type: "separator" },
      {
        label: "Cut",
        accelerator: "CommandOrControl+X",
        role: "cut",
      },
      {
        label: "Copy",
        accelerator: "CommandOrControl+C",
        role: "copy",
      },
      {
        label: "Paste",
        accelerator: "CommandOrControl+V",
        role: "paste",
      },
      {
        label: "Paste and match style",
        accelerator: "CommandOrControl+Shift+V",
        role: "pasteAndMatchStyle",
      },
      {
        label: "Select All",
        accelerator: "CommandOrControl+A",
        role: "selectAll",
      },
    ],
  },
  {
    label: "Navigate",
    submenu: [
      {
        label: "Home",
        accelerator: "Alt+h",
        click: (_item, win) => {
          win.loadURL(new URL(win.webContents.getURL()).origin);
        },
      },
      {
        label: "Reload",
        accelerator: "CommandOrControl+r",
        role: "forceReload",
      },
      {
        label: "Back",
        accelerator: "CommandOrControl+[",
        click: (_item, win) => {
          win.webContents.goBack();
        },
      },
      {
        label: "Forward",
        accelerator: "CommandOrControl+]",
        click: (_item, win) => {
          win.webContents.goForward();
        },
      },
    ],
  },
  {
    label: "Develop",
    submenu: [
      {
        label: "Open in Browser",
        click: (_item, win) => {
          shell.openExternal(win.webContents.getURL());
        },
      },
      {
        label: "Open Space Folder",
        click: (_item, win) => {
          let url = win.webContents.getURL();
          shell.openPath(findInstanceByUrl(new URL(url)).folder);
        },
      },
      {
        label: "Toggle Dev Tools",
        accelerator: "CommandOrControl+Alt+J",
        role: "toggleDevTools",
      },
    ],
  },
  {
    label: "Window",
    role: "windowMenu",
    submenu: [
      {
        label: "Minimize",
        accelerator: "CommandOrControl+M",
        role: "minimize",
      },
      {
        label: "Maximize",
        click: (_item, win) => {
          win.maximize();
        },
      },
      {
        label: "Close",
        accelerator: "CommandOrControl+W",
        role: "close",
      },
    ],
  },
];

if (process.platform === "darwin") {
  const name = app.getName();
  template.unshift({
    label: name,
    submenu: [
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  });
}

export const menu = Menu.buildFromTemplate(template);
