import { app, BrowserWindow, dialog, Menu } from "electron";
const path = require("path");
import { ExpressServer } from "@silverbulletmd/server/express_server";
import * as fs from "fs";

let mainWindow: BrowserWindow | undefined;

const mainMenuTemplate: Electron.MenuItemConstructorOptions[] = [
  {
    label: "File",
    submenu: [
      {
        label: "Switch Folder",
        click: async () => {
          let result = await dialog.showOpenDialog(mainWindow!, {
            properties: ["openDirectory"],
          });
          if (result.canceled) {
            return;
          }
          openFolder(result.filePaths[0]).catch(console.error);
        },
      },
      {
        label: "Exit",
        click: () => {
          app.quit();
        },
      },
    ],
  },
  { label: "Edit" },
  { label: "Tools", submenu: [{ label: "Sup" }] },
];

if (process.platform === "darwin") {
  const name = "Fire Sale";
  mainMenuTemplate.unshift({ label: name });
}
const mainMenu = Menu.buildFromTemplate(mainMenuTemplate);
Menu.setApplicationMenu(mainMenu);

const port = 3002;
const distDir = path.resolve(
  `${__dirname}/../../packages/silverbullet-web/dist`
);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  // eslint-disable-line global-require
  app.quit();
}

let currentFolder = app.getPath("userData");

fs.mkdirSync(currentFolder, { recursive: true });
let server: ExpressServer | undefined;

async function openFolder(path: string) {
  console.log("Opening folder", path);
  if (server) {
    await server.stop();
  }
  currentFolder = path;
  console.log("Starting new server");
  server = new ExpressServer(port, path, distDir);
  await server.start();
  console.log("Reloading page");
  mainWindow!.reload();
}

async function createWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  await openFolder(currentFolder);

  // and load the index.html of the app.
  mainWindow.loadURL(`http://localhost:${port}`);

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", async () => {
  await createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
