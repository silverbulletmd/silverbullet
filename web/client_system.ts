import { PlugNamespaceHook } from "$common/hooks/plug_namespace.ts";
import { SilverBulletHooks } from "../lib/manifest.ts";
import { CronHook } from "../lib/plugos/hooks/cron.ts";
import { EventHook } from "../common/hooks/event.ts";
import { createSandbox } from "../lib/plugos/sandboxes/web_worker_sandbox.ts";

import assetSyscalls from "../lib/plugos/syscalls/asset.ts";
import { eventSyscalls } from "../lib/plugos/syscalls/event.ts";
import { System } from "../lib/plugos/system.ts";
import type { Client } from "./client.ts";
import { CodeWidgetHook } from "./hooks/code_widget.ts";
import { CommandHook } from "$common/hooks/command.ts";
import { SlashCommandHook } from "./hooks/slash_command.ts";
import { clientStoreSyscalls } from "./syscalls/clientStore.ts";
import { debugSyscalls } from "./syscalls/debug.ts";
import { editorSyscalls } from "./syscalls/editor.ts";
import { sandboxFetchSyscalls } from "./syscalls/fetch.ts";
import { markdownSyscalls } from "$common/syscalls/markdown.ts";
import { shellSyscalls } from "./syscalls/shell.ts";
import { spaceReadSyscalls, spaceWriteSyscalls } from "./syscalls/space.ts";
import { syncSyscalls } from "./syscalls/sync.ts";
import { systemSyscalls } from "$common/syscalls/system.ts";
import { yamlSyscalls } from "$common/syscalls/yaml.ts";
import { Space } from "../common/space.ts";
import { MQHook } from "../lib/plugos/hooks/mq.ts";
import { mqSyscalls } from "../lib/plugos/syscalls/mq.ts";
import { mqProxySyscalls } from "./syscalls/mq.proxy.ts";
import { dataStoreProxySyscalls } from "./syscalls/datastore.proxy.ts";
import {
  dataStoreReadSyscalls,
  dataStoreWriteSyscalls,
} from "../lib/plugos/syscalls/datastore.ts";
import { DataStore } from "$lib/data/datastore.ts";
import { languageSyscalls } from "$common/syscalls/language.ts";
import { templateSyscalls } from "$common/syscalls/template.ts";
import { codeWidgetSyscalls } from "./syscalls/code_widget.ts";
import { clientCodeWidgetSyscalls } from "./syscalls/client_code_widget.ts";
import { KVPrimitivesManifestCache } from "$lib/plugos/manifest_cache.ts";
import { deepObjectMerge } from "../plug-api/lib/json.ts";
import { Query } from "../plug-api/types.ts";
import { PanelWidgetHook } from "./hooks/panel_widget.ts";
import { createKeyBindings } from "./editor_state.ts";
import { CommonSystem } from "$common/common_system.ts";
import { DataStoreMQ } from "$lib/data/mq.datastore.ts";
import { plugPrefix } from "$common/spaces/constants.ts";

const plugNameExtractRegex = /\/(.+)\.plug\.js$/;

/**
 * Wrapper around a System, used by the client
 */
export class ClientSystem extends CommonSystem {
  constructor(
    private client: Client,
    mq: DataStoreMQ,
    ds: DataStore,
    eventHook: EventHook,
    readOnlyMode: boolean,
  ) {
    super(
      mq,
      ds,
      eventHook,
      readOnlyMode,
      window.silverBulletConfig.enableSpaceScript,
    );
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
    this.commandHook = new CommandHook(
      this.readOnlyMode,
      this.spaceScriptCommands,
    );
    this.commandHook.on({
      commandsUpdated: (commandMap) => {
        this.client.ui?.viewDispatch({
          type: "update-commands",
          commands: commandMap,
        });
        // Replace the key mapping compartment (keybindings)
        this.client.editorView.dispatch({
          effects: this.client.keyHandlerCompartment?.reconfigure(
            createKeyBindings(this.client),
          ),
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
        if (path.startsWith(plugPrefix) && path.endsWith(".plug.js")) {
          const plugName = plugNameExtractRegex.exec(path)![1];
          console.log("Plug updated, reloading", plugName, "from", path);
          this.system.unload(path);
          await this.system.load(
            plugName,
            createSandbox(new URL(`/${path}`, location.href)),
            newHash,
          );
        }
      },
    );
  }

  init() {
    // Slash command hook
    this.slashCommandHook = new SlashCommandHook(this.client);
    this.system.addHook(this.slashCommandHook);

    // Syscalls available to all plugs
    this.system.registerSyscalls(
      [],
      eventSyscalls(this.eventHook),
      editorSyscalls(this.client),
      spaceReadSyscalls(this.client),
      systemSyscalls(this.system, false, this, this.client),
      markdownSyscalls(),
      assetSyscalls(this.system),
      yamlSyscalls(),
      templateSyscalls(this.ds),
      codeWidgetSyscalls(this.codeWidgetHook),
      clientCodeWidgetSyscalls(),
      languageSyscalls(),
      this.client.syncMode
        // In sync mode handle locally
        ? mqSyscalls(this.mq)
        // In non-sync mode proxy to server
        : mqProxySyscalls(this.client),
      ...this.client.syncMode
        ? [dataStoreReadSyscalls(this.ds), dataStoreWriteSyscalls(this.ds)]
        : [dataStoreProxySyscalls(this.client)],
      debugSyscalls(this.client),
      syncSyscalls(this.client),
      clientStoreSyscalls(this.ds),
    );

    if (!this.readOnlyMode) {
      // Write syscalls
      this.system.registerSyscalls(
        [],
        spaceWriteSyscalls(this.client),
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
