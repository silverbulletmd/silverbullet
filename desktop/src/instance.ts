import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { app, BrowserWindow, dialog, Menu, MenuItem, shell, nativeImage } from "electron";
import portfinder from "portfinder";
import fetch from "node-fetch";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import {
  newWindowState,
  persistWindowState,
  removeWindow,
  WindowState,
} from "./store";

declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

type Instance = {
  folder: string;
  port: number;
  // Increased with "browser-window-created" event, decreased wtih "close" event
  refcount: number;
  proc: ChildProcessWithoutNullStreams;
};

export const runningServers = new Map<string, Instance>();

// Should work for Liux and Mac
let denoPath = `${process.resourcesPath}/deno`;

// If not...
if (!existsSync(denoPath)) {
  // Windows
  if (platform() === "win32") {
    if (existsSync(`${process.resourcesPath}/deno.exe`)) {
      denoPath = `${process.resourcesPath}/deno.exe`;
    } else {
      denoPath = "deno.exe";
    }
  } else {
    // Everything else
    denoPath = "deno";
  }
}

async function folderPicker(): Promise<string> {
  const dialogReturn = await dialog.showOpenDialog({
    title: "Pick a page folder",
    properties: ["openDirectory", "createDirectory"],
  });

  if (dialogReturn.filePaths.length === 1) {
    return dialogReturn.filePaths[0];
  }
}

export async function openFolderPicker() {
  const folderPath = await folderPicker();
  if (folderPath) {
    openFolder(newWindowState(folderPath));
  }
}

export async function openFolder(windowState: WindowState): Promise<void> {
  const instance = await spawnInstance(windowState.folderPath);
  newWindow(instance, windowState);
}

function determineSilverBulletScriptPath(): string {
  let scriptPath = `${process.resourcesPath}/silverbullet.js`;
  if (!existsSync(scriptPath)) {
    console.log("Dev mode");
    // Assumption: we're running in dev mode (npm start)
    scriptPath = "../silverbullet.ts";
  }
  return scriptPath;
}

async function spawnInstance(pagePath: string): Promise<Instance> {
  let instance = runningServers.get(pagePath);
  if (instance) {
    return instance;
  }

  // Pick random port
  portfinder.setBasePort(3010);
  portfinder.setHighestPort(3999);
  const port = await portfinder.getPortPromise();

  const proc = spawn(denoPath, [
    "run",
    "-A",
    "--unstable",
    determineSilverBulletScriptPath(),
    "--port",
    "" + port,
    pagePath,
  ]);

  proc.stdout.on("data", (data) => {
    process.stdout.write(`[SB Out] ${data}`);
  });

  proc.stderr.on("data", (data) => {
    process.stderr.write(`[SB Err] ${data}`);
  });

  proc.on("close", (code) => {
    if (code) {
      console.log(`child process exited with code ${code}`);
    }
  });

  // Try for 15s to see if SB is live
  for (let i = 0; i < 30; i++) {
    try {
      const result = await fetch(`http://localhost:${port}`);
      if (result.ok) {
        console.log("Live!");
        instance = {
          folder: pagePath,
          port: port,
          refcount: 0,
          proc: proc,
        };
        runningServers.set(pagePath, instance);
        return instance;
      }
      console.log("Still booting...");
    } catch {
      console.log("Still booting...");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// TODO: Make more specific
export function findInstanceByUrl(url: URL) {
  for (const instance of runningServers.values()) {
    if (instance.port === +url.port) {
      return instance;
    }
  }
  return null;
}

let quitting = false;

const icon = nativeImage.createFromPath(process.resourcesPath + "/logo.png");
export function newWindow(instance: Instance, windowState: WindowState) {
  // Create the browser window.
  console.log("Empty icon?", icon.isEmpty());
  const window = new BrowserWindow({
    height: windowState.height,
    width: windowState.width,
    x: windowState.x,
    y: windowState.y,
    icon,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  instance.refcount++;

  persistWindowState(windowState, window);

  window.webContents.setWindowOpenHandler(({ url }) => {
    const instance = findInstanceByUrl(new URL(url));
    if (instance) {
      newWindow(instance, newWindowState(instance.folder));
    } else {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("context-menu", (event, params) => {
    const menu = new Menu();

    // Allow users to add the misspelled word to the dictionary
    if (params.misspelledWord) {
      // Add each spelling suggestion
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(
          new MenuItem({
            label: suggestion,
            click: () => window.webContents.replaceMisspelling(suggestion),
          }),
        );
      }
      if (params.dictionarySuggestions.length > 0) {
        menu.append(new MenuItem({ type: "separator" }));
      }
      menu.append(
        new MenuItem({
          label: "Add to dictionary",
          click: () =>
            window.webContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord,
            ),
        }),
      );
      menu.append(new MenuItem({ type: "separator" }));
    }

    menu.append(new MenuItem({ label: "Cut", role: "cut" }));
    menu.append(new MenuItem({ label: "Copy", role: "copy" }));
    menu.append(new MenuItem({ label: "Paste", role: "paste" }));
    menu.popup();
  });

  window.on("resized", () => {
    console.log("Reized window");
    persistWindowState(windowState, window);
  });

  window.on("moved", () => {
    persistWindowState(windowState, window);
  });

  window.webContents.on("did-navigate-in-page", () => {
    persistWindowState(windowState, window);
  });

  window.once("close", () => {
    console.log("Closed window");
    instance.refcount--;
    console.log("Refcount", instance.refcount);
    if (!quitting) {
      removeWindow(windowState);
    }
    if (instance.refcount === 0) {
      console.log("Stopping server");
      instance.proc.kill();
      runningServers.delete(instance.folder);
    }
  });

  window.loadURL(`http://localhost:${instance.port}${windowState.urlPath}`);
}

app.on("before-quit", () => {
  console.log("Quitting");
  quitting = true;
});
