import { BrowserWindow } from "electron";
import Store from "electron-store";

export type WindowState = {
  id: string; // random GUID
  width: number;
  height: number;
  x?: number;
  y?: number;
  folderPath: string;
  urlPath: string;
};

const store = new Store({
  defaults: {
    openWindows: [],
  },
});

export function getOpenWindows(): WindowState[] {
  return store.get("openWindows");
}

import crypto from "node:crypto";

export function newWindowState(folderPath: string): WindowState {
  return {
    id: crypto.randomBytes(16).toString("hex"),
    width: 800,
    height: 600,
    x: undefined,
    y: undefined,
    folderPath,
    urlPath: "/",
  };
}

export function persistWindowState(
  windowState: WindowState,
  window: BrowserWindow,
) {
  const [width, height] = window.getSize();
  const [x, y] = window.getPosition();
  windowState.height = height;
  windowState.width = width;
  windowState.x = x;
  windowState.y = y;
  const urlString = window.webContents.getURL();
  if (urlString) {
    console.log("New url", urlString);
    windowState.urlPath = new URL(urlString).pathname;
  }

  let found = false;
  const newWindows = getOpenWindows().map((win) => {
    if (win.id === windowState.id) {
      found = true;
      return windowState;
    } else {
      return win;
    }
  });
  if (!found) {
    newWindows.push(windowState);
  }
  store.set(
    "openWindows",
    newWindows,
  );
}

export function removeWindow(windowState: WindowState) {
  const newWindows = getOpenWindows().filter((win) =>
    win.id !== windowState.id
  );
  store.set(
    "openWindows",
    newWindows,
  );
}
