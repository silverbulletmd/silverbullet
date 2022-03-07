import { Editor } from "./editor";
import { HttpRemoteSpace } from "./space";
import { safeRun } from "./util";
import { io } from "socket.io-client";

let socket = io("http://localhost:3000");

let editor = new Editor(
  new HttpRemoteSpace(`http://${location.hostname}:3000/fs`, socket),
  document.getElementById("root")!
);

safeRun(async () => {
  await editor.init();
});

// @ts-ignore
window.editor = editor;
