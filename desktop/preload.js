const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  url: "http://localhost:3000",
});
