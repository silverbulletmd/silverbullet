import { Editor } from "./editor";
import { parseYamlSettings, safeRun } from "@silverbulletmd/common/util";
import { Space } from "@silverbulletmd/common/spaces/space";
import { HttpSpacePrimitives } from "@silverbulletmd/common/spaces/http_space_primitives";

safeRun(async () => {
  let password: string | undefined =
    localStorage.getItem("password") || undefined;

  let httpPrimitives = new HttpSpacePrimitives("", password);
  let settingsPageText = "";
  while (true) {
    try {
      settingsPageText = (await httpPrimitives.readPage("SETTINGS")).text;
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
      if (e.message === 'Unauthorized Github') {
        console.log('It\'s a github login'); // We might need to differentiate somehow if we add other Oauth logins
        if (!document.getElementById('oauth-login')) {
          const root = document.getElementById('sb-root');
          const a = document.createElement('a');
          a.href = '/auth/oauth';
          a.id = 'oauth-login';
          const login = document.createTextNode('Login via Github'); // So ugly, but working
          a.appendChild(login);
          root?.appendChild(a);  
        }
      }
      console.error(`error initializing the settings page: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  let serverSpace = new Space(httpPrimitives, true);
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

// if (!isDesktop) {
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

// }
