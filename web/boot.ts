import { Editor } from "./editor.tsx";
import { parseYamlSettings, safeRun } from "../common/util.ts";
import { Space } from "../common/spaces/space.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import { PageNamespaceHook } from "../common/hooks/page_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { System } from "../plugos/system.ts";
import { BuiltinSettings } from "./types.ts";
import { pageIndexSyscalls } from "./syscalls/index.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { clientStoreSyscalls } from "./syscalls/clientStore.ts";
import { sandboxFetchSyscalls } from "./syscalls/fetch.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { AssetBundlePlugSpacePrimitives } from "../common/spaces/asset_bundle_space_primitives.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { IndexedDBSpacePrimitives } from "../common/spaces/indexeddb_space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";

import plugAssetBundle from "../dist/plug_asset_bundle.json" assert {
  type: "json",
};
import { storeSyscalls } from "../plugos/syscalls/store.dexie_browser.ts";
import { FileMetaSpacePrimitives } from "../common/spaces/file_meta_space_primitives.ts";

safeRun(async () => {
  // Instantiate a PlugOS system for the client
  const system = new System<SilverBulletHooks>();

  // Attach the page namespace hook
  const namespaceHook = new PageNamespaceHook();
  system.addHook(namespaceHook);

  // Event hook
  const eventHook = new EventHook();
  system.addHook(eventHook);

  const cronHook = new CronHook(system);

  system.addHook(cronHook);

  const indexSyscalls = pageIndexSyscalls("page_index", globalThis.indexedDB);

  const spacePrimitives = new FileMetaSpacePrimitives(
    new AssetBundlePlugSpacePrimitives(
      new EventedSpacePrimitives(
        new PlugSpacePrimitives(
          new IndexedDBSpacePrimitives(
            "space",
            globalThis.indexedDB,
          ),
          namespaceHook,
        ),
        eventHook,
      ),
      new AssetBundle(plugAssetBundle),
    ),
    indexSyscalls,
  );

  let settingsPageText = "";
  try {
    settingsPageText = (
      await spacePrimitives.readFile("SETTINGS.md", "utf8")
    ).data as string;
  } catch (e: any) {
    console.error("No settings page found", e.message);
    settingsPageText = "```yaml\nindexPage: index\n```\n";
  }

  const serverSpace = new Space(spacePrimitives);
  serverSpace.watch();

  // Register some web-specific syscall implementations
  system.registerSyscalls(
    [],
    storeSyscalls("store", "data", globalThis.indexedDB),
    indexSyscalls,
    clientStoreSyscalls(),
    // fulltextSyscalls(serverSpace),
    sandboxFetchSyscalls(serverSpace),
  );

  console.log("Booting...");

  const settings = parseYamlSettings(settingsPageText) as BuiltinSettings;

  if (!settings.indexPage) {
    settings.indexPage = "index";
  }

  const editor = new Editor(
    serverSpace,
    system,
    eventHook,
    document.getElementById("sb-root")!,
    "",
    settings,
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
