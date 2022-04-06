import { Editor } from "./editor";
import { safeRun } from "./util";
import { WatchableSpace } from "./spaces/cache_space";
import { HttpRestSpace } from "./spaces/httprest_space";

// let localSpace = new WatchableSpace(new IndexedDBSpace("pages"), true);
// localSpace.watch();
let serverSpace = new WatchableSpace(new HttpRestSpace(""), true);
serverSpace.watch();

// @ts-ignore
// window.syncer = async () => {
//   let lastSync = +(localStorage.getItem("lastSync") || "0");
//   let syncer = new SpaceSync(serverSpace, localSpace, lastSync, "_trash/");
//   await syncer.syncPages(
//     SpaceSync.primaryConflictResolver(serverSpace, localSpace)
//   );
//   localStorage.setItem("lastSync", "" + syncer.lastSync);
//   console.log("Done!");
// };
let editor = new Editor(serverSpace, document.getElementById("root")!);

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
