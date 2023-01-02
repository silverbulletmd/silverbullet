import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { app, BrowserWindow, dialog, Menu } from "electron";
import portfinder from "portfinder";
import fetch from "node-fetch";
import fs from "node:fs";
import { platform } from "node:os";
import { store } from "./store";

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
if (!fs.existsSync(denoPath)) {
  // Windows
  if (platform() === "win32") {
    if (fs.existsSync(`${process.resourcesPath}/deno.exe`)) {
      denoPath = `${process.resourcesPath}/deno.exe`;
    } else {
      denoPath = "deno.exe";
    }
  } else {
    // Everything else
    denoPath = "deno";
  }
}

export async function folderPicker(): Promise<string> {
  const dialogReturn = await dialog.showOpenDialog({
    title: "Pick a page folder",
    properties: ["openDirectory", "createDirectory"],
  });

  if (dialogReturn.filePaths.length === 1) {
    const folderPath = dialogReturn.filePaths[0];
    let allOpenFolders: string[] = store.get("openFolders");
    allOpenFolders.push(folderPath);
    app.addRecentDocument(folderPath);
    store.set("openFolders", allOpenFolders);
    return folderPath;
  }
}

export async function openFolder(path: string): Promise<void> {
  const instance = await spawnInstance(path);
  openWindow(instance);
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
    "https://get.silverbullet.md",
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

export function findInstanceByUrl(url: URL) {
  for (const instance of runningServers.values()) {
    if (instance.port === +url.port) {
      return instance;
    }
  }
  return null;
}

export function openWindow(instance: Instance) {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    height: 600,
    width: 800,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  // and load the index.html of the app.
  mainWindow.loadURL(`http://localhost:${instance.port}`);
}
