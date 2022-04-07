import { Editor } from "./editor";
import { safeRun } from "./util";
import { WatchableSpace } from "./spaces/cache_space";
import { HttpRestSpace } from "./spaces/httprest_space";
import { IndexedDBSpace } from "./spaces/indexeddb_space";
import { SpaceSync } from "./spaces/sync";

let localSpace = new WatchableSpace(new IndexedDBSpace("pages"), true);
localSpace.watch();
let serverSpace = new WatchableSpace(new HttpRestSpace(""), true);
// serverSpace.watch();

// @ts-ignore
window.syncer = async () => {
  let lastLocalSync = +(localStorage.getItem("lastLocalSync") || "0"),
    lastRemoteSync = +(localStorage.getItem("lastRemoteSync") || "0");
  let syncer = new SpaceSync(
    serverSpace,
    localSpace,
    lastRemoteSync,
    lastLocalSync,
    "_trash/"
  );
  await syncer.syncPages(
    SpaceSync.primaryConflictResolver(serverSpace, localSpace)
  );
  localStorage.setItem("lastLocalSync", "" + syncer.secondaryLastSync);
  localStorage.setItem("lastRemoteSync", "" + syncer.primaryLastSync);
  console.log("Done!");
};
let editor = new Editor(localSpace, document.getElementById("root")!);

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
