import { Editor } from "./editor";
import { HttpFileSystem } from "./fs";
import { safeRun } from "./util";

let editor = new Editor(
  new HttpFileSystem(`http://${location.hostname}:2222/fs`),
  document.getElementById("root")!
);

safeRun(async () => {
  await editor.init();
});

// @ts-ignore
window.editor = editor;
