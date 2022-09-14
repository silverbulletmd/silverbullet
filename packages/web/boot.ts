import { Editor } from "./editor";
import { parseYamlSettings, safeRun } from "@silverbulletmd/common/util";
import { Space } from "@silverbulletmd/common/spaces/space";
import { HttpSpacePrimitives } from "@silverbulletmd/common/spaces/http_space_primitives";

import "./styles/main.scss";

safeRun(async () => {
  console.log("I'm GOING TO BOOT");
  let password: string | undefined =
    localStorage.getItem("password") || undefined;
  let httpPrimitives = new HttpSpacePrimitives("", password);
  let settingsPageText = "";
  while (true) {
    try {
      settingsPageText = (await (
        await httpPrimitives.readFile("SETTINGS.md", "string")
      ).data) as string;
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
  let serverSpace = new Space(httpPrimitives);
  serverSpace.watch();

  console.log("Booting...");

  let settings = parseYamlSettings(settingsPageText);

  let editor = new Editor(
    serverSpace,
    document.getElementById("sb-root")!,
    "",
    settings.indexPage || "index"
  );
  await editor.init();
  // @ts-ignore
  window.editor = editor;
});

if (localStorage.getItem("disable_sw") !== "true") {
  if (navigator.serviceWorker) {
    navigator.serviceWorker
      .register(new URL("service_worker.ts", import.meta.url), {
        type: "module",
      })
      .then((r) => {
        console.log("Service worker registered...");
      });
  } else {
    console.log(
      "No launching service worker (not present, maybe because not running on localhost or over SSL)"
    );
  }
}
