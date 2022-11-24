import { Editor } from "./editor.tsx";
import { parseYamlSettings, safeRun } from "../common/util.ts";
import { Space } from "../common/spaces/space.ts";
import { HttpSpacePrimitives } from "../common/spaces/http_space_primitives.ts";
import { PlugSpacePrimitives } from "../server/hooks/plug_space_primitives.ts";
import { PageNamespaceHook } from "../server/hooks/page_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { System } from "../plugos/system.ts";

safeRun(async () => {
  let password: string | undefined = localStorage.getItem("password") ||
    undefined;

  let httpPrimitives = new HttpSpacePrimitives("", password);
  let settingsPageText = "";
  while (true) {
    try {
      settingsPageText = (
        await httpPrimitives.readFile("SETTINGS.md", "string")
      ).data as string;
      break;
    } catch (e: any) {
      if (e.message === "Unauthorized") {
        password = prompt("Password: ") || undefined;
        if (!password) {
          alert("Sorry, need a password");
          return;
        }
        localStorage.setItem("password", password!);
        httpPrimitives = new HttpSpacePrimitives("", password);
      }
    }
  }

  // Instantiate a PlugOS system for the client
  const system = new System<SilverBulletHooks>("client");

  // Attach the page namespace hook
  const namespaceHook = new PageNamespaceHook();
  system.addHook(namespaceHook);

  const spacePrimitives = new PlugSpacePrimitives(
    httpPrimitives,
    namespaceHook,
    "client",
  );

  const serverSpace = new Space(spacePrimitives);
  serverSpace.watch();

  console.log("Booting...");

  const settings = parseYamlSettings(settingsPageText);

  const editor = new Editor(
    serverSpace,
    system,
    document.getElementById("sb-root")!,
    "",
    settings.indexPage || "index",
  );
  // @ts-ignore: for convenience
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
} else {
  console.log(
    "No launching service worker (not present, maybe because not running on localhost or over SSL)",
  );
}
