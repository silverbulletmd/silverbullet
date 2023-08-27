import { PlugNamespaceHook } from "../common/hooks/plug_namespace.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import { loadMarkdownExtensions } from "../common/markdown_parser/markdown_ext.ts";
import buildMarkdown from "../common/markdown_parser/parser.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { FileMetaSpacePrimitives } from "../common/spaces/file_meta_space_primitives.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import { createSandbox } from "../plugos/environments/webworker_sandbox.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { EndpointHook } from "../plugos/hooks/endpoint.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { MQHook } from "../plugos/hooks/mq.ts";
import { DenoKVStore } from "../plugos/lib/kv_store.deno_kv.ts";
import { DexieMQ } from "../plugos/lib/mq.dexie.ts";
import assetSyscalls from "../plugos/syscalls/asset.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import { mqSyscalls } from "../plugos/syscalls/mq.dexie.ts";
import { storeSyscalls } from "../plugos/syscalls/store.ts";
import { System } from "../plugos/system.ts";
import { Space } from "../web/space.ts";
import { debugSyscalls } from "../web/syscalls/debug.ts";
import { pageIndexSyscalls } from "../cli/syscalls/index.ts";
import { markdownSyscalls } from "../web/syscalls/markdown.ts";
import { spaceSyscalls } from "../cli/syscalls/space.ts";
import { systemSyscalls } from "../web/syscalls/system.ts";
import { yamlSyscalls } from "../web/syscalls/yaml.ts";
import { Application, path } from "./deps.ts";
import { sandboxFetchSyscalls } from "../plugos/syscalls/fetch.ts";
import { shellSyscalls } from "../plugos/syscalls/shell.deno.ts";
import { IDBKeyRange, indexedDB } from "https://esm.sh/fake-indexeddb@4.0.2";
import { SpacePrimitives } from "../common/spaces/space_primitives.ts";

export class ServerSystem {
  system: System<SilverBulletHooks> = new System("server");
  spacePrimitives!: SpacePrimitives;
  requeueInterval?: number;
  kvStore?: DenoKVStore;

  constructor(
    private baseSpacePrimitives: SpacePrimitives,
    private dbPath: string,
    private app: Application,
  ) {
  }

  // Always needs to be invoked right after construction
  async init() {
    // Event hook
    const eventHook = new EventHook();
    this.system.addHook(eventHook);

    // Cron hook
    const cronHook = new CronHook(this.system);
    this.system.addHook(cronHook);

    this.kvStore = new DenoKVStore();
    await this.kvStore.init(this.dbPath);

    // Endpoint hook
    this.system.addHook(new EndpointHook(this.app, "/_/"));

    // Use DexieMQ for this, in memory
    const mq = new DexieMQ("mq", indexedDB, IDBKeyRange);

    this.requeueInterval = setInterval(() => {
      // Timeout after 5s, retries 3 times, otherwise drops the message (no DLQ)
      mq.requeueTimeouts(5000, 3, true).catch(console.error);
    }, 20000); // Look to requeue every 20s

    const pageIndexCalls = pageIndexSyscalls(this.kvStore);

    const plugNamespaceHook = new PlugNamespaceHook();
    this.system.addHook(plugNamespaceHook);

    this.system.addHook(new MQHook(this.system, mq));

    this.spacePrimitives = new FileMetaSpacePrimitives(
      new EventedSpacePrimitives(
        new PlugSpacePrimitives(
          this.baseSpacePrimitives,
          plugNamespaceHook,
        ),
        eventHook,
      ),
      pageIndexCalls,
    );
    const space = new Space(this.spacePrimitives, this.kvStore, eventHook);

    // Add syscalls
    this.system.registerSyscalls(
      [],
      eventSyscalls(eventHook),
      spaceSyscalls(space),
      assetSyscalls(this.system),
      yamlSyscalls(),
      storeSyscalls(this.kvStore),
      systemSyscalls(undefined as any, this.system),
      mqSyscalls(mq),
      pageIndexCalls,
      debugSyscalls(),
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

    // for (let plugPath of await space.listPlugs()) {
    //   plugPath = path.resolve(this.spacePath, plugPath);
    //   await this.system.load(
    //     new URL(`file://${plugPath}`),
    //     createSandbox,
    //   );
    // }

    // Load markdown syscalls based on all new syntax (if any)
    this.system.registerSyscalls(
      [],
      markdownSyscalls(buildMarkdown(loadMarkdownExtensions(this.system))),
    );
  }

  async loadPlugs() {
    const tempDir = await Deno.makeTempDir();
    try {
      for (const { name } of await this.spacePrimitives.fetchFileList()) {
        if (
          name.endsWith(".plug.js") // && !filePath.includes("search.plug.js")
        ) {
          const plugPath = path.join(tempDir, name);
          await Deno.mkdir(path.dirname(plugPath), { recursive: true });
          await Deno.writeFile(
            plugPath,
            (await this.spacePrimitives.readFile(name)).data,
          );
          await this.system.load(
            new URL(`file://${plugPath}`),
            createSandbox,
          );
        }
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  }

  async close() {
    clearInterval(this.requeueInterval);
    await this.system.unloadAll();
  }
}
