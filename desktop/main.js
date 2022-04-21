const { app, BrowserWindow, protocol } = require("electron");
const path = require("path");

console.log("Got here", process.version);

const createWindow = () => {
  const WEB_FOLDER = "../dist/webapp";
  const PROTOCOL = "file";

  protocol.interceptFileProtocol(PROTOCOL, (request, callback) => {
    // Strip protocol
    let url = request.url.substring(PROTOCOL.length + 2);
    if (url.endsWith("/")) {
      url = url.substring(0, url.length - 1);
    }

    console.log("Requested url", url);

    if (!/\.(js|css|png|webmanifest|map)/.exec(url)) {
      url = "/index.html";
    }

    if (url.includes("/service_worker.js?")) {
      url = "/service_worker.js";
    }

    // if (!url.includes(".")) {
    //   url = "/index.html";
    // }

    // Build complete path for node require function
    url = path.join(__dirname, WEB_FOLDER, url);

    // Replace backslashes by forward slashes (windows)
    // url = url.replace(/\\/g, '/');
    url = path.normalize(url);

    // console.log("Requested path", url);
    callback({ path: url });
  });

  // Create the browser window.
  let mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // and load the index.html of the app.
  mainWindow.loadURL("file://start");
  // url.format({
  //   pathname: "index.html",
  //   protocol: PROTOCOL + ":",
  //   slashes: true,
  // })
  // );
};
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
