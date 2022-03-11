import { Editor } from "./editor";
import { RealtimeSpace } from "./space";
import { safeRun } from "./util";
import { io } from "socket.io-client";

let socket = io(`http://${location.hostname}:3000`);

let editor = new Editor(
  new RealtimeSpace(socket),
  document.getElementById("root")!
);

safeRun(async () => {
  await editor.init();
});

// @ts-ignore
window.editor = editor;
