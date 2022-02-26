import { Editor } from "./editor";
import { HttpRemoteSpace } from "./space";
import { safeRun } from "./util";

let editor = new Editor(
  new HttpRemoteSpace(`http://${location.hostname}:2222/fs`),
  document.getElementById("root")!
);

safeRun(async () => {
  await editor.init();
});

// @ts-ignore
window.editor = editor;
