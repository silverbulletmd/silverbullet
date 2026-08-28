import { BasenameIndex } from "@silverbulletmd/silverbullet/lib/resolve_path";
import { PlugNamespaceHook } from "./plugos/hooks/plug_namespace.ts";
import type { SilverBulletHooks } from "@silverbulletmd/silverbullet/type/manifest";
import type { EventHook } from "./plugos/hooks/event.ts";
import { WorkerSandbox } from "./plugos/sandboxes/worker_sandbox.ts";

import assetSyscalls from "./plugos/syscalls/asset.ts";
import { System } from "./plugos/system.ts";
import type { Client } from "./client.ts";
import { CodeWidgetHook } from "./plugos/hooks/code_widget.ts";
import { CommandHook } from "./plugos/hooks/command.ts";
import { SlashCommandHook } from "./plugos/hooks/slash_command.ts";
import { SyscallHook } from "./plugos/hooks/syscall.ts";
import { clientStoreSyscalls } from "./plugos/syscalls/clientStore.ts";
import { editorSyscalls } from "./plugos/syscalls/editor.ts";
import { sandboxFetchSyscalls } from "./plugos/syscalls/fetch.ts";
import { markdownSyscalls } from "./plugos/syscalls/markdown.ts";
import { shellSyscalls } from "./plugos/syscalls/shell.ts";
import {
  spaceReadSyscalls,
  spaceWriteSyscalls,
} from "./plugos/syscalls/space.ts";
import { syncSyscalls } from "./plugos/syscalls/sync.ts";
import { systemSyscalls } from "./plugos/syscalls/system.ts";
import type { Space } from "./space.ts";
import { MQHook } from "./plugos/hooks/mq.ts";
import { mqSyscalls } from "./plugos/syscalls/mq.ts";
import {
  dataStoreReadSyscalls,
  dataStoreWriteSyscalls,
} from "./plugos/syscalls/datastore.ts";
import type { DataStore } from "./data/datastore.ts";
import { languageSyscalls } from "./plugos/syscalls/language.ts";
import { codeWidgetSyscalls } from "./plugos/syscalls/code_widget.ts";
import { clientCodeWidgetSyscalls } from "./plugos/syscalls/client_code_widget.ts";
import { KVPrimitivesManifestCache } from "./plugos/manifest_cache.ts";
import { createCommandKeyBindings } from "./codemirror/editor_state.ts";
import type { DataStoreMQ } from "./data/mq.datastore.ts";
import { jsonschemaSyscalls } from "./plugos/syscalls/jsonschema.ts";
import { luaSyscalls } from "./space_lua/syscalls.ts";
import { indexSyscalls } from "./plugos/syscalls/index.ts";
import { configSyscalls } from "./plugos/syscalls/config.ts";
import { eventSyscalls } from "./plugos/syscalls/event.ts";
import { DocumentEditorHook } from "./plugos/hooks/document_editor.ts";
import type { Command } from "./types/command.ts";
import { SpaceLuaEnvironment } from "./space_lua.ts";
import type { ILuaFunction } from "./space_lua/runtime.ts";
import { builtinPlugPaths } from "../plugs/builtin_plugs.ts";
import { registerEditorCommands } from "./editor_commands.ts";
import { ServiceRegistry } from "./service_registry.ts";
import { serviceRegistrySyscalls } from "./plugos/syscalls/service_registry.ts";
import type { ObjectIndex } from "./data/object_index.ts";
import { searchSyscalls } from "./plugos/syscalls/search.ts";
import { iconSyscalls } from "./plugos/syscalls/icon.ts";
import { navigatorSyscalls } from "./plugos/syscalls/navigator.ts";
import { setRevisionsAvailable } from "./navigator/builtins.ts";
import { registerNavigatorCommands } from "./navigator/commands.ts";
import { restoreDocks, setSpaceDocks } from "./navigator/navigator.ts";
import { clearScriptViews, setLuaEnvSource } from "./navigator/registry.ts";
import type { Config } from "./config.ts";

const mqTimeout = 10000;
const mqTimeoutRetry = 3;

function resolveSpaceDocks(config: Config): Record<string, string> {
  const viewDocks = config.get<Record<string, string> | undefined>(
    "view.docks",
    undefined,
  );
  return viewDocks ?? config.get("navigator.docks", {});
}

/**
 * Handles the extension-related mechanisms of the client by wrapping a PlugOS System object as well as Space Lua environments
 */
export class ClientSystem {
  system!: System<SilverBulletHooks>;
  commandHook!: CommandHook;
  slashCommandHook!: SlashCommandHook;
  namespaceHook!: PlugNamespaceHook;
  codeWidgetHook!: CodeWidgetHook;
  documentEditorHook!: DocumentEditorHook;
  mqHook!: MQHook;

  serviceRegistry!: ServiceRegistry;

  spaceLuaEnv: SpaceLuaEnvironment;
  readonly scriptCommands = new Map<string, Command>();
  readonly luaCodeWidgets = new Map<
    string,
    { language: string; render: ILuaFunction }
  >();
  scriptsLoaded: boolean = false;

  readonly allKnownFiles = new BasenameIndex();
  public knownFilesLoaded: boolean = false;

  constructor(
    private client: Client,
    protected mq: DataStoreMQ,
    public ds: DataStore,
    public eventHook: EventHook,
    private objectIndex: ObjectIndex,
    public readOnlyMode: boolean,
  ) {
    this.system = new System(undefined, {
      manifestCache: new KVPrimitivesManifestCache<SilverBulletHooks>(
        ds.kv,
        "manifest",
      ),
    });

    this.spaceLuaEnv = new SpaceLuaEnvironment(this.system, objectIndex);
    this.serviceRegistry = new ServiceRegistry(this.eventHook, client.config);

    setInterval(() => {
      mq.requeueTimeouts(mqTimeout, mqTimeoutRetry, true).catch(console.error);
    }, 20000);

    this.system.addHook(this.eventHook);

    this.namespaceHook = new PlugNamespaceHook();
    this.system.addHook(this.namespaceHook);

    this.codeWidgetHook = new CodeWidgetHook();
    this.system.addHook(this.codeWidgetHook);

    this.documentEditorHook = new DocumentEditorHook();
    this.system.addHook(this.documentEditorHook);

    this.commandHook = new CommandHook(this.readOnlyMode, this.scriptCommands);
    registerEditorCommands(client, this.commandHook);
    // Read-only spaces get no revision surface at all
    const revisionsAvailable =
      !this.readOnlyMode &&
      !!this.client.bootConfig.revisions &&
      this.client.bootConfig.revisions !== "disabled";
    setRevisionsAvailable(revisionsAvailable);
    registerNavigatorCommands(this.commandHook, revisionsAvailable);
    setSpaceDocks(resolveSpaceDocks(this.client.config));
    this.commandHook.on({
      commandsUpdated: (commandMap) => {
        this.client.ui?.viewDispatch({
          type: "update-commands",
          commands: commandMap,
        });
        this.client.editorView.dispatch({
          effects: this.client.commandKeyHandlerCompartment?.reconfigure(
            createCommandKeyBindings(this.client),
          ),
        });
      },
    });

    this.slashCommandHook = new SlashCommandHook(this.client);

    this.mqHook = new MQHook(this.system, this.mq, this.client.config);
    this.system.addHook(this.mqHook);

    this.system.addHook(new SyscallHook());

    this.eventHook.addLocalListener("editor:reloadState", async () => {
      await this.reloadState();
    });

    this.eventHook.addLocalListener("editor:init", () => restoreDocks());
  }

  init() {
    // Init is called after the editor is initialized, so we can safely add the command hook
    this.system.addHook(this.commandHook);
    this.system.addHook(this.slashCommandHook);

    // Client code reusing plug-facing helpers (the navigator's built-in
    // views) reaches syscalls through plug-api's late-bound global.
    (globalThis as any).syscall = (name: string, ...args: any[]) =>
      this.system.localSyscall(name, args);

    setLuaEnvSource(() => this.spaceLuaEnv.env);

    this.system.registerSyscalls(
      [],
      eventSyscalls(this.eventHook, this.client),
      editorSyscalls(this.client),
      spaceReadSyscalls(this.client),
      systemSyscalls(client, this.readOnlyMode),
      markdownSyscalls(client),
      assetSyscalls(this.system),
      codeWidgetSyscalls(this.codeWidgetHook),
      clientCodeWidgetSyscalls(this.client),
      languageSyscalls(),
      jsonschemaSyscalls(),
      indexSyscalls(this.objectIndex, this.client),
      luaSyscalls(this.system, () => this.spaceLuaEnv.env),
      mqSyscalls(this.mq),
      serviceRegistrySyscalls(this.serviceRegistry),
      dataStoreReadSyscalls(this.ds, this),
      dataStoreWriteSyscalls(this.ds),
      syncSyscalls(this.client),
      clientStoreSyscalls(this.ds),
      configSyscalls(this.client.config),
      searchSyscalls(),
      iconSyscalls(),
      navigatorSyscalls(),
    );

    if (!this.readOnlyMode) {
      this.system.registerSyscalls([], spaceWriteSyscalls(this.client));
      this.system.registerSyscalls(
        ["fetch"],
        sandboxFetchSyscalls(this.client),
      );

      this.system.registerSyscalls(["shell"], shellSyscalls(this.client));
    }
  }

  async loadLuaScripts() {
    if (this.client.bootConfig.disableSpaceLua) {
      console.info("Space Lua scripts are disabled, skipping loading scripts");
      return;
    }
    if (!(await this.objectIndex.isIndexAvailable())) {
      console.info(
        "Not loading space scripts, since no index is available yet",
      );
      return;
    }
    this.client.config.clear();
    clearScriptViews();
    try {
      await this.spaceLuaEnv.reload();
    } catch (e: any) {
      console.error("Error loading Lua script:", e.message);
    }

    this.scriptCommands.clear();
    for (const [name, command] of Object.entries(
      this.client.config.get<Record<string, Command>>("commands", {}),
    )) {
      this.scriptCommands.set(name, command);
    }

    this.luaCodeWidgets.clear();
    for (const [language, def] of Object.entries(
      this.client.config.get<
        Record<string, { language: string; render: ILuaFunction }>
      >("codeWidgets", {}),
    )) {
      if (def && typeof (def as any).render?.call === "function") {
        this.luaCodeWidgets.set(language, def);
      }
    }

    this.commandHook.throttledBuildAllCommandsAndEmit();
    this.slashCommandHook.throttledBuildAllCommands();
    this.mqHook.throttledReloadQueues();

    setSpaceDocks(resolveSpaceDocks(this.client.config));

    this.scriptsLoaded = true;
    this.client.maybeDispatchWidgetsReady();
  }

  async loadPlugFromPath(path: string, lastModified: number) {
    await this.system.loadPlug(WorkerSandbox.forPath(path), path, lastModified);
  }

  async reloadPlugsFromSpace(space: Space) {
    console.log("(Re)loading plugs");
    await this.system.unloadAll();

    let allPlugs = await space.listPlugs();
    if (this.client.bootConfig.disablePlugs) {
      allPlugs = allPlugs.filter(({ name }) => builtinPlugPaths.includes(name));

      console.warn("Not loading custom plugs as `disablePlugs` has been set");
    }

    await Promise.all(
      allPlugs.map((fileMeta) =>
        this.loadPlugFromPath(fileMeta.name, fileMeta.lastModified).catch((e) =>
          console.error(
            `Could not load plug ${fileMeta.name} error: ${e.message}`,
          ),
        ),
      ),
    );
  }

  localSyscall(name: string, args: any[]) {
    return this.system.localSyscall(name, args);
  }

  public async reloadState() {
    console.log(
      "Now loading space scripts, custom styles and rebuilding editor state",
    );
    await this.loadLuaScripts();
    await this.client.loadCustomStyles();
    this.client.rebuildEditorState();
  }
}
