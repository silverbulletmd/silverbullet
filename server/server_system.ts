import { PlugNamespaceHook } from "../common/hooks/plug_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import { createSandbox } from "../plugos/sandboxes/web_worker_sandbox.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { MQHook } from "../plugos/hooks/mq.ts";
import assetSyscalls from "../plugos/syscalls/asset.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import { mqSyscalls } from "../plugos/syscalls/mq.ts";
import { System } from "../plugos/system.ts";
import { Space } from "../web/space.ts";
import { markdownSyscalls } from "../common/syscalls/markdown.ts";
import { spaceReadSyscalls, spaceWriteSyscalls } from "./syscalls/space.ts";
import { systemSyscalls } from "../common/syscalls/system.ts";
import { yamlSyscalls } from "../common/syscalls/yaml.ts";
import { sandboxFetchSyscalls } from "../plugos/syscalls/fetch.ts";
import { shellSyscalls } from "./syscalls/shell.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { base64EncodedDataUrl } from "../plugos/asset_bundle/base64.ts";
import { Plug } from "../plugos/plug.ts";
import { DataStore } from "../plugos/lib/datastore.ts";
import {
  dataStoreReadSyscalls,
  dataStoreWriteSyscalls,
} from "../plugos/syscalls/datastore.ts";
import { DataStoreMQ } from "../plugos/lib/mq.datastore.ts";
import { languageSyscalls } from "../common/syscalls/language.ts";
import { templateSyscalls } from "../common/syscalls/template.ts";
import { codeWidgetSyscalls } from "../web/syscalls/code_widget.ts";
import { CodeWidgetHook } from "../web/hooks/code_widget.ts";
import { KVPrimitivesManifestCache } from "../plugos/manifest_cache.ts";
import { KvPrimitives } from "../plugos/lib/kv_primitives.ts";
import { ShellBackend } from "./shell_backend.ts";
import { ensureSpaceIndex } from "../common/space_index.ts";
import { FileMeta } from "$sb/types.ts";
import { buildQueryFunctions } from "../common/query_functions.ts";

// // Important: load this before the actual plugs
// import {
//   createSandbox as noSandboxFactory,
//   runWithSystemLock,
// } from "../plugos/sandboxes/no_sandbox.ts";

// // Load list of builtin plugs
// import { plug as plugIndex } from "../dist_plug_bundle/_plug/index.plug.js";
// import { plug as plugFederation } from "../dist_plug_bundle/_plug/federation.plug.js";
// import { plug as plugQuery } from "../dist_plug_bundle/_plug/query.plug.js";
// import { plug as plugSearch } from "../dist_plug_bundle/_plug/search.plug.js";
// import { plug as plugTasks } from "../dist_plug_bundle/_plug/tasks.plug.js";
// import { plug as plugTemplate } from "../dist_plug_bundle/_plug/template.plug.js";

const fileListInterval = 30 * 1000; // 30s

const plugNameExtractRegex = /([^/]+)\.plug\.js$/;

export class ServerSystem {
  system!: System<SilverBulletHooks>;
  public spacePrimitives!: SpacePrimitives;
  // denoKv!: Deno.Kv;
  listInterval?: number;
  ds!: DataStore;
  allKnownPages = new Set<string>();

  constructor(
    private baseSpacePrimitives: SpacePrimitives,
    readonly kvPrimitives: KvPrimitives,
    private shellBackend: ShellBackend,
    private readOnlyMode: boolean,
  ) {
  }

  // Always needs to be invoked right after construction
  async init(awaitIndex = false) {
    this.system = new System(
      "server",
      {
        manifestCache: new KVPrimitivesManifestCache(
          this.kvPrimitives,
          "manifest",
        ),
        plugFlushTimeout: 5 * 60 * 1000, // 5 minutes
      },
    );

    this.ds = new DataStore(
      this.kvPrimitives,
      buildQueryFunctions(this.allKnownPages, this.system),
    );

    // Event hook
    const eventHook = new EventHook();
    this.system.addHook(eventHook);

    // Cron hook
    const cronHook = new CronHook(this.system);
    this.system.addHook(cronHook);

    const mq = new DataStoreMQ(this.ds);

    setInterval(() => {
      // Timeout after 5s, retries 3 times, otherwise drops the message (no DLQ)
      mq.requeueTimeouts(5000, 3, true).catch(console.error);
    }, 20000); // Look to requeue every 20s

    const plugNamespaceHook = new PlugNamespaceHook();
    this.system.addHook(plugNamespaceHook);

    this.system.addHook(new MQHook(this.system, mq));

    const codeWidgetHook = new CodeWidgetHook();

    this.system.addHook(codeWidgetHook);

    this.spacePrimitives = new EventedSpacePrimitives(
      new PlugSpacePrimitives(
        this.baseSpacePrimitives,
        plugNamespaceHook,
      ),
      eventHook,
    );
    const space = new Space(this.spacePrimitives, eventHook);

    // Add syscalls
    this.system.registerSyscalls(
      [],
      eventSyscalls(eventHook),
      spaceReadSyscalls(space),
      assetSyscalls(this.system),
      yamlSyscalls(),
      systemSyscalls(this.system, this.readOnlyMode),
      mqSyscalls(mq),
      languageSyscalls(),
      templateSyscalls(this.ds.functionMap),
      dataStoreReadSyscalls(this.ds),
      codeWidgetSyscalls(codeWidgetHook),
      markdownSyscalls(),
    );

    if (!this.readOnlyMode) {
      // Write mode only
      this.system.registerSyscalls(
        [],
        spaceWriteSyscalls(space),
        dataStoreWriteSyscalls(this.ds),
      );

      // Syscalls that require some additional permissions
      this.system.registerSyscalls(
        ["fetch"],
        sandboxFetchSyscalls(),
      );

      this.system.registerSyscalls(
        ["shell"],
        shellSyscalls(this.shellBackend),
      );
    }

    await this.loadPlugs();

    this.listInterval = setInterval(() => {
      // runWithSystemLock(this.system, async () => {
      //   await space.updatePageList();
      // });
      space.updatePageList().catch(console.error);
    }, fileListInterval);

    eventHook.addLocalListener("file:changed", async (path, localChange) => {
      if (!localChange && path.endsWith(".md")) {
        const pageName = path.slice(0, -3);
        const data = await this.spacePrimitives.readFile(path);
        console.log("Outside page change: reindexing", pageName);
        // Change made outside of editor, trigger reindex
        await eventHook.dispatchEvent("page:index_text", {
          name: pageName,
          text: new TextDecoder().decode(data.data),
        });
      }

      if (path.startsWith("_plug/") && path.endsWith(".plug.js")) {
        console.log("Plug updated, reloading:", path);
        this.system.unload(path);
        await this.loadPlugFromSpace(path);
      }
    });

    eventHook.addLocalListener(
      "file:listed",
      (allFiles: FileMeta[]) => {
        // Update list of known pages
        this.allKnownPages.clear();
        allFiles.forEach((f) => {
          if (f.name.endsWith(".md")) {
            this.allKnownPages.add(f.name.slice(0, -3));
          }
        });
      },
    );

    // Ensure a valid index
    const indexPromise = ensureSpaceIndex(this.ds, this.system);
    if (awaitIndex) {
      await indexPromise;
    }

    // await runWithSystemLock(this.system, async () => {
    await eventHook.dispatchEvent("system:ready");
    // });
  }

  async loadPlugs() {
    // await this.system.load("index", noSandboxFactory(plugIndex));
    // await this.system.load("federation", noSandboxFactory(plugFederation));
    // await this.system.load("query", noSandboxFactory(plugQuery));
    // await this.system.load("search", noSandboxFactory(plugSearch));
    // await this.system.load("tasks", noSandboxFactory(plugTasks));
    // await this.system.load("template", noSandboxFactory(plugTemplate));

    for (const { name } of await this.spacePrimitives.fetchFileList()) {
      if (plugNameExtractRegex.test(name)) {
        await this.loadPlugFromSpace(name);
      }
    }
  }

  async loadPlugFromSpace(path: string): Promise<Plug<SilverBulletHooks>> {
    const { meta, data } = await this.spacePrimitives.readFile(path);
    const plugName = path.match(plugNameExtractRegex)![1];
    return this.system.load(
      plugName,
      createSandbox(
        // Base64 encoding this to support `deno compile` mode
        new URL(base64EncodedDataUrl("application/javascript", data)),
      ),
      meta.lastModified,
    );
  }

  async close() {
    clearInterval(this.listInterval);
    await this.system.unloadAll();
  }
}
