const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktop", true);
