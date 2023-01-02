import { app, Menu, MenuItemConstructorOptions } from "electron";
import { findInstanceByUrl, folderPicker, openWindow } from "./instance";

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
            openWindow(instance);
          }
        },
      },
      {
        label: "Open Folder",
        click: () => {
          folderPicker();
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
    label: "Window",
    submenu: [
      {
        label: "Minimize",
        accelerator: "CommandOrControl+M",
        role: "minimize",
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
