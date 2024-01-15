import { PlugNamespaceHook } from "../common/hooks/plug_namespace.ts";
import { Manifest, SilverBulletHooks } from "../common/manifest.ts";
import buildMarkdown from "../common/markdown_parser/parser.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { createSandbox } from "../plugos/sandboxes/web_worker_sandbox.ts";

import assetSyscalls from "../plugos/syscalls/asset.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import { System } from "../plugos/system.ts";
import type { Client } from "./client.ts";
import { CodeWidgetHook } from "./hooks/code_widget.ts";
import { CommandHook } from "./hooks/command.ts";
import { SlashCommandHook } from "./hooks/slash_command.ts";
import { clientStoreSyscalls } from "./syscalls/clientStore.ts";
import { debugSyscalls } from "./syscalls/debug.ts";
import { editorSyscalls } from "./syscalls/editor.ts";
import { sandboxFetchSyscalls } from "./syscalls/fetch.ts";
import { markdownSyscalls } from "../common/syscalls/markdown.ts";
import { shellSyscalls } from "./syscalls/shell.ts";
import { spaceSyscalls } from "./syscalls/space.ts";
import { syncSyscalls } from "./syscalls/sync.ts";
import { systemSyscalls } from "./syscalls/system.ts";
import { yamlSyscalls } from "../common/syscalls/yaml.ts";
import { Space } from "./space.ts";
import {
  loadMarkdownExtensions,
  MDExt,
} from "../common/markdown_parser/markdown_ext.ts";
import { MQHook } from "../plugos/hooks/mq.ts";
import { mqSyscalls } from "../plugos/syscalls/mq.ts";
import { mqProxySyscalls } from "./syscalls/mq.proxy.ts";
import { dataStoreProxySyscalls } from "./syscalls/datastore.proxy.ts";
import { dataStoreSyscalls } from "../plugos/syscalls/datastore.ts";
import { DataStore } from "../plugos/lib/datastore.ts";
import { MessageQueue } from "../plugos/lib/mq.ts";
import { languageSyscalls } from "../common/syscalls/language.ts";
import { handlebarsSyscalls } from "../common/syscalls/handlebars.ts";
import { codeWidgetSyscalls } from "./syscalls/code_widget.ts";
import { clientCodeWidgetSyscalls } from "./syscalls/client_code_widget.ts";
import { KVPrimitivesManifestCache } from "../plugos/manifest_cache.ts";
import { deepObjectMerge } from "$sb/lib/json.ts";
import { Query } from "$sb/types.ts";
import { PanelWidgetHook } from "./hooks/panel_widget.ts";

const plugNameExtractRegex = /\/(.+)\.plug\.js$/;

export class ClientSystem {
  commandHook: CommandHook;
  slashCommandHook: SlashCommandHook;
  namespaceHook: PlugNamespaceHook;
  codeWidgetHook: CodeWidgetHook;
  mdExtensions: MDExt[] = [];
  system: System<SilverBulletHooks>;
  panelWidgetHook: PanelWidgetHook;

  constructor(
    private client: Client,
    private mq: MessageQueue,
    private ds: DataStore,
    private eventHook: EventHook,
  ) {
    // Only set environment to "client" when running in thin client mode, otherwise we run everything locally (hybrid)
    this.system = new System(
      client.syncMode ? undefined : "client",
      {
        manifestCache: new KVPrimitivesManifestCache<SilverBulletHooks>(
          ds.kv,
          "manifest",
        ),
      },
    );

    this.system.addHook(this.eventHook);

    // Plug page namespace hook
    this.namespaceHook = new PlugNamespaceHook();
    this.system.addHook(this.namespaceHook);

    // Cron hook
    const cronHook = new CronHook(this.system);
    this.system.addHook(cronHook);

    // Code widget hook
    this.codeWidgetHook = new CodeWidgetHook();
    this.system.addHook(this.codeWidgetHook);

    // Panel widget hook
    this.panelWidgetHook = new PanelWidgetHook();
    this.system.addHook(this.panelWidgetHook);

    // MQ hook
    if (client.syncMode) {
      // Process MQ messages locally
      this.system.addHook(new MQHook(this.system, this.mq));
    }

    // Command hook
    this.commandHook = new CommandHook();
    this.commandHook.on({
      commandsUpdated: (commandMap) => {
        this.client.ui?.viewDispatch({
          type: "update-commands",
          commands: commandMap,
        });
      },
    });
    this.system.addHook(this.commandHook);

    // Slash command hook
    this.slashCommandHook = new SlashCommandHook(this.client);
    this.system.addHook(this.slashCommandHook);

    this.system.on({
      plugLoaded: (plug) => {
        // Apply plug overrides
        const manifestOverrides = this.client.settings.plugOverrides;
        if (manifestOverrides && manifestOverrides[plug.manifest!.name]) {
          plug.manifest = deepObjectMerge(
            plug.manifest,
            manifestOverrides[plug.manifest!.name],
          );
          // console.log("New manifest", plug.manifest);
        }
      },
    });

    this.eventHook.addLocalListener(
      "file:changed",
      async (path: string, _selfUpdate, _oldHash, newHash) => {
        if (path.startsWith("_plug/") && path.endsWith(".plug.js")) {
          const plugName = plugNameExtractRegex.exec(path)![1];
          console.log("Plug updated, reloading", plugName, "from", path);
          this.system.unload(path);
          const plug = await this.system.load(
            plugName,
            createSandbox(new URL(`/${path}`, location.href)),
            newHash,
          );
          if ((plug.manifest! as Manifest).syntax) {
            // If there are syntax extensions, rebuild the markdown parser immediately
            this.updateMarkdownParser();
          }
          this.client.debouncedPlugsUpdatedEvent();
        }
      },
    );
  }

  async init() {
    // Slash command hook
    this.slashCommandHook = new SlashCommandHook(this.client);
    this.system.addHook(this.slashCommandHook);

    // Syscalls available to all plugs
    this.system.registerSyscalls(
      [],
      eventSyscalls(this.eventHook),
      editorSyscalls(this.client),
      spaceSyscalls(this.client),
      systemSyscalls(this.system, this.client),
      markdownSyscalls(buildMarkdown(this.mdExtensions)),
      assetSyscalls(this.system),
      yamlSyscalls(),
      handlebarsSyscalls(),
      codeWidgetSyscalls(this.codeWidgetHook),
      clientCodeWidgetSyscalls(),
      languageSyscalls(),
      this.client.syncMode
        // In sync mode handle locally
        ? mqSyscalls(this.mq)
        // In non-sync mode proxy to server
        : mqProxySyscalls(this.client),
      this.client.syncMode
        ? dataStoreSyscalls(this.ds)
        : dataStoreProxySyscalls(this.client),
      debugSyscalls(),
      syncSyscalls(this.client),
      clientStoreSyscalls(this.ds),
    );

    // Syscalls that require some additional permissions
    this.system.registerSyscalls(
      ["fetch"],
      sandboxFetchSyscalls(this.client),
    );

    this.system.registerSyscalls(
      ["shell"],
      shellSyscalls(this.client),
    );
  }

  async reloadPlugsFromSpace(space: Space) {
    console.log("Loading plugs");
    // await space.updatePageList();
    await this.system.unloadAll();
    console.log("(Re)loading plugs");
    await Promise.all((await space.listPlugs()).map(async (plugMeta) => {
      try {
        const plugName = plugNameExtractRegex.exec(plugMeta.name)![1];
        await this.system.load(
          plugName,
          createSandbox(new URL(plugMeta.name, location.origin)),
          plugMeta.lastModified,
        );
      } catch (e: any) {
        console.error(
          "Could not load plug",
          plugMeta.name,
          "error:",
          e.message,
        );
      }
    }));
  }

  updateMarkdownParser() {
    // Load all syntax extensions
    this.mdExtensions = loadMarkdownExtensions(this.system);
    // And reload the syscalls to use the new syntax extensions
    this.system.registerSyscalls(
      [],
      markdownSyscalls(buildMarkdown(this.mdExtensions)),
    );
  }

  localSyscall(name: string, args: any[]) {
    return this.system.localSyscall(name, args);
  }

  queryObjects<T>(tag: string, query: Query): Promise<T[]> {
    return this.localSyscall(
      "system.invokeFunction",
      ["index.queryObjects", tag, query],
    );
  }
}
