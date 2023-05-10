import { Editor } from "./editor.tsx";
import { parseYamlSettings, safeRun, sha1 } from "../common/util.ts";
import { Space } from "../common/spaces/space.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import { PageNamespaceHook } from "../common/hooks/page_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { System } from "../plugos/system.ts";
import { BuiltinSettings } from "./types.ts";
import { pageIndexSyscalls } from "./syscalls/index.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { sandboxFetchSyscalls } from "./syscalls/fetch.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { IndexedDBSpacePrimitives } from "../common/spaces/indexeddb_space_primitives.ts";
import { storeSyscalls } from "../plugos/syscalls/store.dexie_browser.ts";
import { FileMetaSpacePrimitives } from "../common/spaces/file_meta_space_primitives.ts";
import { SyncEngine } from "./sync.ts";

declare global {
  interface Window {
    // Injected via index.html
    spacePath: string;
  }
}

safeRun(async () => {
  // Instantiate a PlugOS system for the client
  const system = new System<SilverBulletHooks>();

  // Generate a semi-unique prefix for the database so not to reuse databases for different space paths
  const dbPrefix = (await sha1(window.spacePath)).substring(0, 8);

  // Attach the page namespace hook
  const namespaceHook = new PageNamespaceHook();
  system.addHook(namespaceHook);

  // Event hook
  const eventHook = new EventHook();
  system.addHook(eventHook);

  const cronHook = new CronHook(system);

  system.addHook(cronHook);

  const indexSyscalls = pageIndexSyscalls(
    `${dbPrefix}_page_index`,
    globalThis.indexedDB,
  );
  const storeCalls = storeSyscalls(
    `${dbPrefix}_store`,
    "data",
    globalThis.indexedDB,
  );

  const localSpacePrimitives = new FileMetaSpacePrimitives(
    new EventedSpacePrimitives(
      new PlugSpacePrimitives(
        new IndexedDBSpacePrimitives(
          `${dbPrefix}_space`,
          globalThis.indexedDB,
        ),
        namespaceHook,
      ),
      eventHook,
    ),
    indexSyscalls,
  );

  const localSpace = new Space(localSpacePrimitives);
  localSpace.watch();

  // Register some web-specific syscall implementations
  system.registerSyscalls(
    [],
    storeCalls,
    indexSyscalls,
    // fulltextSyscalls(serverSpace),
    sandboxFetchSyscalls(localSpace),
  );

  const syncEngine = new SyncEngine(
    localSpacePrimitives,
    storeCalls,
    eventHook,
  );
  await syncEngine.init();

  console.log("Booting...");

  let settingsText: string | undefined;

  try {
    settingsText = (await localSpace.readPage("SETTINGS")).text;
  } catch {
    console.log("No SETTINGS page, syncing...");
    await syncEngine.syncFile("SETTINGS.md");
    settingsText = (await localSpace.readPage("SETTINGS")).text;
  }
  const settings = parseYamlSettings(settingsText!) as BuiltinSettings;

  if (!settings.indexPage) {
    settings.indexPage = "index";
  }

  try {
    await localSpace.getPageMeta(settings.indexPage);
  } catch {
    console.log("No index page, syncing...");
    await syncEngine.syncFile(settings.indexPage + ".md");
  }

  const editor = new Editor(
    localSpace,
    system,
    eventHook,
    document.getElementById("sb-root")!,
    "",
    settings,
  );

  // @ts-ignore: for convenience
  window.editor = editor;

  await editor.init();
  syncEngine.syncSpace().catch(console.error);

  setInterval(() => {
    syncEngine.syncSpace().catch(console.error);
  }, 10 * 1000);
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
