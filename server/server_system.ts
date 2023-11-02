import { PlugNamespaceHook } from "../common/hooks/plug_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { loadMarkdownExtensions } from "../common/markdown_parser/markdown_ext.ts";
import buildMarkdown from "../common/markdown_parser/parser.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import { createSandbox } from "../plugos/environments/webworker_sandbox.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { EndpointHook } from "../plugos/hooks/endpoint.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { MQHook } from "../plugos/hooks/mq.ts";
import assetSyscalls from "../plugos/syscalls/asset.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import { mqSyscalls } from "../plugos/syscalls/mq.ts";
import { System } from "../plugos/system.ts";
import { Space } from "../web/space.ts";
import { debugSyscalls } from "../web/syscalls/debug.ts";
import { markdownSyscalls } from "../common/syscalls/markdown.ts";
import { spaceSyscalls } from "./syscalls/space.ts";
import { systemSyscalls } from "../web/syscalls/system.ts";
import { yamlSyscalls } from "../common/syscalls/yaml.ts";
import { Application } from "./deps.ts";
import { sandboxFetchSyscalls } from "../plugos/syscalls/fetch.ts";
import { shellSyscalls } from "../plugos/syscalls/shell.deno.ts";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { base64EncodedDataUrl } from "../plugos/asset_bundle/base64.ts";
import { Plug } from "../plugos/plug.ts";
import { DenoKvPrimitives } from "../plugos/lib/deno_kv_primitives.ts";
import { DataStore } from "../plugos/lib/datastore.ts";
import { dataStoreSyscalls } from "../plugos/syscalls/datastore.ts";
import { DataStoreMQ } from "../plugos/lib/mq.datastore.ts";
import { languageSyscalls } from "../common/syscalls/language.ts";
import { handlebarsSyscalls } from "../common/syscalls/handlebars.ts";
import { codeWidgetSyscalls } from "../web/syscalls/code_widget.ts";
import { CodeWidgetHook } from "../web/hooks/code_widget.ts";

const fileListInterval = 30 * 1000; // 30s

export class ServerSystem {
  system: System<SilverBulletHooks> = new System("server");
  spacePrimitives!: SpacePrimitives;
  denoKv!: Deno.Kv;
  listInterval?: number;
  ds!: DataStore;

  constructor(
    private baseSpacePrimitives: SpacePrimitives,
    private dbPath: string,
    private app: Application,
  ) {
  }

  // Always needs to be invoked right after construction
  async init(awaitIndex = false) {
    // Event hook
    const eventHook = new EventHook();
    this.system.addHook(eventHook);

    // Cron hook
    const cronHook = new CronHook(this.system);
    this.system.addHook(cronHook);

    this.denoKv = await Deno.openKv(this.dbPath);
    this.ds = new DataStore(new DenoKvPrimitives(this.denoKv));

    // Endpoint hook
    this.system.addHook(new EndpointHook(this.app, "/_/"));

    const mq = new DataStoreMQ(this.ds);

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
    const space = new Space(this.spacePrimitives, this.ds, eventHook);

    // Add syscalls
    this.system.registerSyscalls(
      [],
      eventSyscalls(eventHook),
      spaceSyscalls(space),
      assetSyscalls(this.system),
      yamlSyscalls(),
      systemSyscalls(this.system),
      mqSyscalls(mq),
      languageSyscalls(),
      handlebarsSyscalls(),
      dataStoreSyscalls(this.ds),
      debugSyscalls(),
      codeWidgetSyscalls(codeWidgetHook),
      markdownSyscalls(buildMarkdown([])), // Will later be replaced with markdown extensions
    );

    // Syscalls that require some additional permissions
    this.system.registerSyscalls(
      ["fetch"],
      sandboxFetchSyscalls(),
    );

    this.system.registerSyscalls(
      ["shell"],
      shellSyscalls("."),
    );

    await this.loadPlugs();

    // Load markdown syscalls based on all new syntax (if any)
    this.system.registerSyscalls(
      [],
      markdownSyscalls(buildMarkdown(loadMarkdownExtensions(this.system))),
    );

    this.listInterval = setInterval(() => {
      space.updatePageList().catch(console.error);
    }, fileListInterval);

    eventHook.addLocalListener("file:changed", (path, localChange) => {
      (async () => {
        // console.log("!!!!! FILE CHANGED", path, localChange);
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
      })().catch(console.error);
    });

    // Check if this space was ever indexed before
    if (!await this.ds.get(["$initialIndexDone"])) {
      console.log("Indexing space for the first time (in the background)");
      const indexPromise = this.system.loadedPlugs.get("index")!.invoke(
        "reindexSpace",
        [],
      ).then(() => {
        this.ds.set(["$initialIndexDone"], true);
      }).catch(console.error);
      if (awaitIndex) {
        await indexPromise;
      }
    }

    await eventHook.dispatchEvent("system:ready");
  }

  async loadPlugs() {
    for (const { name } of await this.spacePrimitives.fetchFileList()) {
      if (name.endsWith(".plug.js")) {
        await this.loadPlugFromSpace(name);
      }
    }
  }

  async loadPlugFromSpace(path: string): Promise<Plug<SilverBulletHooks>> {
    const plugJS = (await this.spacePrimitives.readFile(path)).data;
    return this.system.load(
      // Base64 encoding this to support `deno compile` mode
      new URL(base64EncodedDataUrl("application/javascript", plugJS)),
      createSandbox,
    );
  }

  async close() {
    clearInterval(this.listInterval);
    await this.system.unloadAll();
  }
}
