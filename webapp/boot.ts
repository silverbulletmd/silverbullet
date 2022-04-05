import { Editor } from "./editor";
import { safeRun } from "./util";
import { IndexedDBSpace } from "./spaces/indexeddb_space";

let editor = new Editor(
  // new HttpRestSpace(""),
  new IndexedDBSpace("pages"),
  document.getElementById("root")!
);

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
