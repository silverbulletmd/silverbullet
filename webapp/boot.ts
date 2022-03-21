import { Editor } from "./editor";
import { Space } from "./space";
import { safeRun } from "./util";
import { io } from "socket.io-client";

let socket = io(`http://${location.hostname}:3000`);

let editor = new Editor(new Space(socket), document.getElementById("root")!);

safeRun(async () => {
  await editor.init();
});

// @ts-ignore
window.editor = editor;

navigator.serviceWorker
  .register(new URL("service_worker.ts", import.meta.url), { type: "module" })
  .then((r) => {
    // console.log("Service worker registered", r);
  });
