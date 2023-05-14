import { safeRun } from "../common/util.ts";
import { Editor } from "./editor.tsx";

safeRun(async () => {
  console.log("Booting");

  const editor = new Editor(
    document.getElementById("sb-root")!,
  );

  window.editor = editor;

  await editor.init();
});

if (navigator.serviceWorker) {
  navigator.serviceWorker
    .register(new URL("/service_worker.js", location.href), {
      type: "module",
    })
    .then(() => {
      console.log("Service worker registered...");
    });
  navigator.serviceWorker.ready.then((registration) => {
    registration.active!.postMessage({
      type: "config",
      config: window.silverBulletConfig,
    });
  });
} else {
  console.log(
    "No launching service worker (not present, maybe because not running on localhost or over SSL)",
  );
}
