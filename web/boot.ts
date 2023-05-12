import { Editor } from "./editor.tsx";
import { parseYamlSettings, safeRun, simpleHash } from "../common/util.ts";
import { Space } from "../common/spaces/space.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import { PageNamespaceHook } from "../common/hooks/page_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { createSandbox } from "../plugos/environments/webworker_sandbox.ts";
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
import { clientStoreSyscalls } from "./syscalls/clientStore.ts";
import { shellSyscalls } from "./syscalls/shell.ts";

declare global {
  interface Window {
    // Injected via index.html
    silverBulletConfig: {
      spaceFolderPath: string;
      syncEndpoint: string;
    };
  }
}

// Used for full space sync
const syncInterval = 10 * 1000;

safeRun(async () => {
  const runtimeConfig = window.silverBulletConfig;

  // Instantiate a PlugOS system
  const system = new System<SilverBulletHooks>();

  // Generate a semi-unique prefix for the database so not to reuse databases for different space paths
  const dbPrefix = "" + simpleHash(runtimeConfig.spaceFolderPath);

  // Attach the page namespace hook
  const namespaceHook = new PageNamespaceHook();
  system.addHook(namespaceHook);

  // Event hook
  const eventHook = new EventHook();
  system.addHook(eventHook);

  // Cron hook
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

  const plugSpacePrimitives = new PlugSpacePrimitives(
    new IndexedDBSpacePrimitives(
      `${dbPrefix}_space`,
      globalThis.indexedDB,
    ),
    namespaceHook,
  );
  const localSpacePrimitives = new FileMetaSpacePrimitives(
    new EventedSpacePrimitives(
      plugSpacePrimitives,
      eventHook,
    ),
    indexSyscalls,
  );

  // Track if any plugs have updated during sync cycle
  let plugsUpdated = false;

  eventHook.addLocalListener("plug:changed", async (fileName) => {
    console.log("Plug updated, reloading:", fileName);
    system.unload(fileName);
    await system.load(
      JSON.parse(await localSpace.readFile(fileName, "utf8")),
      createSandbox,
    );
    plugsUpdated = true;
  });

  const localSpace = new Space(localSpacePrimitives);
  localSpace.watch();

  let syncEngine: SyncEngine | undefined;

  if (runtimeConfig.syncEndpoint) {
    syncEngine = new SyncEngine(
      localSpacePrimitives,
      runtimeConfig.syncEndpoint,
      storeCalls,
      eventHook,
      runtimeConfig.spaceFolderPath,
      (path) => {
        return !plugSpacePrimitives.isLikelyHandled(path);
      },
    );
    await syncEngine.init();
  }

  // Register some web-specific syscall implementations
  system.registerSyscalls(
    [],
    storeCalls,
    clientStoreSyscalls(storeCalls),
    indexSyscalls,
    // fulltextSyscalls(serverSpace),
    sandboxFetchSyscalls(syncEngine?.remoteSpace!),
    shellSyscalls(syncEngine?.remoteSpace!),
  );

  console.log("Booting...");

  const settings = await loadSettings(localSpace, syncEngine);

  // Ensure at least the index page is present so we have something to show on a fresh load while syncing the rest in the background
  try {
    await localSpace.getPageMeta(settings.indexPage);
  } catch {
    if (syncEngine) {
      console.log("No index page, syncing...");
      await syncEngine.syncFile(settings.indexPage + ".md");
    }
  }

  if (syncEngine) {
    syncEngine.syncSpace().then(updateAfterSync).catch(console.error);

    setInterval(() => {
      syncEngine!.syncSpace().then(updateAfterSync).catch(console.error);
    }, syncInterval);
  }

  const editor = new Editor(
    localSpace,
    system,
    eventHook,
    document.getElementById("sb-root")!,
    settings,
  );

  // @ts-ignore: for convenience
  window.editor = editor;

  await editor.init();

  async function updateAfterSync(operations: number) {
    if (operations > 0) {
      // Update the page list
      await localSpace.updatePageList();
    }
    if (plugsUpdated) {
      // To register new commands, update editor state based on new plugs
      editor.rebuildEditorState();
    }
    // Reset for next sync cycle
    plugsUpdated = false;
  }

  async function loadSettings(
    localSpace: Space,
    syncEngine?: SyncEngine,
  ): Promise<BuiltinSettings> {
    let settingsText: string | undefined;

    try {
      settingsText = (await localSpace.readPage("SETTINGS")).text;
    } catch {
      if (syncEngine) {
        console.log("No SETTINGS page, syncing...");
        await syncEngine.syncFile("SETTINGS.md");
        settingsText = (await localSpace.readPage("SETTINGS")).text;
      } else {
        settingsText = "```yaml\nindexPage: index\n```\n";
      }
    }
    const settings = parseYamlSettings(settingsText!) as BuiltinSettings;

    if (!settings.indexPage) {
      settings.indexPage = "index";
    }
    return settings;
  }
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
