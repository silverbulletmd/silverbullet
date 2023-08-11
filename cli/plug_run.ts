import { path } from "../common/deps.ts";
import { PlugNamespaceHook } from "../common/hooks/plug_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { loadMarkdownExtensions } from "../common/markdown_parser/markdown_ext.ts";
import buildMarkdown from "../common/markdown_parser/parser.ts";
import { DiskSpacePrimitives } from "../common/spaces/disk_space_primitives.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { FileMetaSpacePrimitives } from "../common/spaces/file_meta_space_primitives.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import { AssetBundle } from "../plugos/asset_bundle/bundle.ts";
import { createSandbox } from "../plugos/environments/deno_sandbox.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { MQHook } from "../plugos/hooks/mq.ts";
import { DenoKVStore } from "../plugos/lib/kv_store.deno_kv.ts";
import { DexieMQ } from "../plugos/lib/mq.dexie.ts";
import assetSyscalls from "../plugos/syscalls/asset.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import { sandboxFetchSyscalls } from "../plugos/syscalls/fetch.ts";
import { mqSyscalls } from "../plugos/syscalls/mq.dexie.ts";
import { shellSyscalls } from "../plugos/syscalls/shell.deno.ts";
import { storeSyscalls } from "../plugos/syscalls/store.ts";
import { System } from "../plugos/system.ts";
import { Space } from "../web/space.ts";
import { debugSyscalls } from "../web/syscalls/debug.ts";
import { pageIndexSyscalls } from "./syscalls/index.ts";
import { markdownSyscalls } from "../web/syscalls/markdown.ts";
import { systemSyscalls } from "../web/syscalls/system.ts";
import { yamlSyscalls } from "../web/syscalls/yaml.ts";
import { spaceSyscalls } from "./syscalls/space.ts";

import { IDBKeyRange, indexedDB } from "https://esm.sh/fake-indexeddb@4.0.2";
import { Application } from "../server/deps.ts";
import { EndpointHook } from "../plugos/hooks/endpoint.ts";
import { sleep } from "../common/async_util.ts";

export async function runPlug(
  spacePath: string,
  functionName: string | undefined,
  args: string[] = [],
  builtinAssetBundle: AssetBundle,
  indexFirst = false,
  httpServerPort = 3123,
  httpHostname = "127.0.0.1",
) {
  spacePath = path.resolve(spacePath);
  const system = new System<SilverBulletHooks>("cli");

  // Event hook
  const eventHook = new EventHook();
  system.addHook(eventHook);

  // Cron hook
  const cronHook = new CronHook(system);
  system.addHook(cronHook);

  const kvStore = new DenoKVStore();
  const tempFile = Deno.makeTempFileSync({ suffix: ".db" });
  await kvStore.init(tempFile);

  // Endpoint hook
  const app = new Application();
  system.addHook(new EndpointHook(app, "/_"));
  const serverController = new AbortController();
  app.listen({
    hostname: httpHostname,
    port: httpServerPort,
    signal: serverController.signal,
  });

  // Use DexieMQ for this, in memory
  const mq = new DexieMQ("mq", indexedDB, IDBKeyRange);

  const pageIndexCalls = pageIndexSyscalls(kvStore);

  const plugNamespaceHook = new PlugNamespaceHook();
  system.addHook(plugNamespaceHook);

  system.addHook(new MQHook(system, mq));

  const spacePrimitives = new FileMetaSpacePrimitives(
    new EventedSpacePrimitives(
      new PlugSpacePrimitives(
        new DiskSpacePrimitives(spacePath),
        plugNamespaceHook,
      ),
      eventHook,
    ),
    pageIndexCalls,
  );
  const space = new Space(spacePrimitives, kvStore);

  // Add syscalls
  system.registerSyscalls(
    [],
    eventSyscalls(eventHook),
    spaceSyscalls(space),
    assetSyscalls(system),
    yamlSyscalls(),
    storeSyscalls(kvStore),
    systemSyscalls(undefined as any, system),
    mqSyscalls(mq),
    pageIndexCalls,
    debugSyscalls(),
    markdownSyscalls(buildMarkdown([])), // Will later be replaced with markdown extensions
  );

  // Syscalls that require some additional permissions
  system.registerSyscalls(
    ["fetch"],
    sandboxFetchSyscalls(),
  );

  system.registerSyscalls(
    ["shell"],
    shellSyscalls("."),
  );

  await loadPlugsFromAssetBundle(system, builtinAssetBundle);

  for (let plugPath of await space.listPlugs()) {
    plugPath = path.resolve(spacePath, plugPath);
    await system.load(
      new URL(`file://${plugPath}`),
      createSandbox,
    );
  }

  // Load markdown syscalls based on all new syntax (if any)
  system.registerSyscalls(
    [],
    markdownSyscalls(buildMarkdown(loadMarkdownExtensions(system))),
  );

  if (indexFirst) {
    await system.loadedPlugs.get("core")!.invoke("reindexSpace", []);
  }

  if (functionName) {
    const [plugName, funcName] = functionName.split(".");

    const plug = system.loadedPlugs.get(plugName);
    if (!plug) {
      throw new Error(`Plug ${plugName} not found`);
    }
    const result = await plug.invoke(funcName, args);
    await system.unloadAll();
    await kvStore.delete();
    serverController.abort();
    return result;
  } else {
    console.log("Running in server mode, use Ctrl-c to stop");
    while (true) {
      await sleep(1000);
    }
  }
}

async function loadPlugsFromAssetBundle(
  system: System<any>,
  assetBundle: AssetBundle,
) {
  const tempDir = await Deno.makeTempDir();
  try {
    for (const filePath of assetBundle.listFiles()) {
      if (
        filePath.endsWith(".plug.js") // && !filePath.includes("search.plug.js")
      ) {
        const plugPath = path.join(tempDir, filePath);
        await Deno.mkdir(path.dirname(plugPath), { recursive: true });
        await Deno.writeFile(plugPath, assetBundle.readFileSync(filePath));
        await system.load(
          new URL(`file://${plugPath}`),
          createSandbox,
        );
      }
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}
