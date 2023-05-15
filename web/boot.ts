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
  console.warn(
    "No launching service worker, likely because not running from localhost or over HTTPs. This means SilverBullet will not be available offline.",
  );
}
