import { Editor } from "./editor";
import { Space } from "./space";
import { safeRun } from "./util";

let editor = new Editor(new Space(""), document.getElementById("root")!);

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
