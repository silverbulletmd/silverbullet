import { app, Menu, MenuItemConstructorOptions, shell } from "electron";
import { findInstanceByUrl, newWindow, openFolderPicker } from "./instance";
import { newWindowState } from "./store";

const template: MenuItemConstructorOptions[] = [
  {
    label: "File",
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
        label: "Open Folder",
        accelerator: "CommandOrControl+Shift+O",
        click: () => {
          openFolderPicker();
        },
      },
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
        label: "Toggle Dev Tools",
        accelerator: "CommandOrControl+Alt+J",
        click: (_item, win) => {
          if (win.webContents.isDevToolsOpened()) {
            win.webContents.closeDevTools();
          } else {
            win.webContents.openDevTools({ mode: "bottom" });
          }
        },
      },
    ],
  },
  {
    label: "Window",
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
  template.unshift({ label: name, submenu: [] });
}

export const menu = Menu.buildFromTemplate(template);
