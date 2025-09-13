import { PlugNamespaceHook } from "./hooks/plug_namespace.ts";
import type { SilverBulletHooks } from "../lib/manifest.ts";
import type { EventHook } from "./hooks/event.ts";
import { createWorkerSandboxFromLocalPath } from "../lib/plugos/sandboxes/web_worker_sandbox.ts";

import assetSyscalls from "../lib/plugos/syscalls/asset.ts";
import { eventSyscalls } from "../lib/plugos/syscalls/event.ts";
import { System } from "../lib/plugos/system.ts";
import type { Client } from "./client.ts";
import { CodeWidgetHook } from "./hooks/code_widget.ts";
import { CommandHook } from "./hooks/command.ts";
import { SlashCommandHook } from "./hooks/slash_command.ts";
import { SyscallHook } from "./hooks/syscall.ts";
import { clientStoreSyscalls } from "./syscalls/clientStore.ts";
import { editorSyscalls } from "./syscalls/editor.ts";
import { sandboxFetchSyscalls } from "./syscalls/fetch.ts";
import { markdownSyscalls } from "./syscalls/markdown.ts";
import { shellSyscalls } from "./syscalls/shell.ts";
import { spaceReadSyscalls, spaceWriteSyscalls } from "./syscalls/space.ts";
import { syncSyscalls } from "./syscalls/sync.ts";
import { systemSyscalls } from "./syscalls/system.ts";
import { yamlSyscalls } from "./syscalls/yaml.ts";
import type { Space } from "./space.ts";
import { MQHook } from "../lib/plugos/hooks/mq.ts";
import { mqSyscalls } from "../lib/plugos/syscalls/mq.ts";
import {
  dataStoreReadSyscalls,
  dataStoreWriteSyscalls,
} from "./syscalls/datastore.ts";
import type { DataStore } from "../lib/data/datastore.ts";
import { languageSyscalls } from "./syscalls/language.ts";
import { codeWidgetSyscalls } from "./syscalls/code_widget.ts";
import { clientCodeWidgetSyscalls } from "./syscalls/client_code_widget.ts";
import { KVPrimitivesManifestCache } from "../lib/plugos/manifest_cache.ts";
import { createKeyBindings } from "./editor_state.ts";
import type { DataStoreMQ } from "../lib/data/mq.datastore.ts";
import { plugPrefix } from "../lib/spaces/constants.ts";
import { jsonschemaSyscalls } from "./syscalls/jsonschema.ts";
import { luaSyscalls } from "./syscalls/lua.ts";
import { indexSyscalls } from "./syscalls/index.ts";
import { configSyscalls } from "./syscalls/config.ts";
import { eventListenerSyscalls } from "./syscalls/event.ts";
import { DocumentEditorHook } from "./hooks/document_editor.ts";
import type { LuaCollectionQuery } from "../lib/space_lua/query_collection.ts";
import type { Command } from "../type/command.ts";
import { SpaceLuaEnvironment } from "./space_lua.ts";
import {
  type ILuaFunction,
  jsToLuaValue,
  luaCall,
  LuaStackFrame,
  type LuaValue,
  luaValueToJS,
} from "../lib/space_lua/runtime.ts";
import { buildThreadLocalEnv, handleLuaError } from "./space_lua_api.ts";
import { builtinPlugPaths } from "../plugs/builtin_plugs.ts";

const indexVersionKey = ["$indexVersion"];
const indexQueuedKey = ["$indexQueued"];
// Bump this one every time a full reindex is needed
const desiredIndexVersion = 8;
const mqTimeout = 10000; // 10s
const mqTimeoutRetry = 3;

/**
 * Wrapper around a System
 */
export class ClientSystem {
  system!: System<SilverBulletHooks>;

  // Hooks
  commandHook!: CommandHook;
  slashCommandHook!: SlashCommandHook;
  namespaceHook!: PlugNamespaceHook;
  codeWidgetHook!: CodeWidgetHook;
  documentEditorHook!: DocumentEditorHook;

  // Known files (for UI)
  readonly allKnownFiles = new Set<string>();
  public knownFilesLoaded: boolean = false;

  readonly scriptCommands = new Map<string, Command>();
  spaceLuaEnv: SpaceLuaEnvironment;
  scriptsLoaded: boolean = false;

  constructor(
    private client: Client,
    protected mq: DataStoreMQ,
    public ds: DataStore,
    public eventHook: EventHook,
    public readOnlyMode: boolean,
  ) {
    this.system = new System(undefined, {
      manifestCache: new KVPrimitivesManifestCache<SilverBulletHooks>(
        ds.kv,
        "manifest",
      ),
    });

    this.spaceLuaEnv = new SpaceLuaEnvironment(this.system);

    setInterval(() => {
      mq.requeueTimeouts(mqTimeout, mqTimeoutRetry, true).catch(console.error);
    }, 20000); // Look to requeue every 20s

    this.system.addHook(this.eventHook);

    // Plug page namespace hook
    this.namespaceHook = new PlugNamespaceHook();
    this.system.addHook(this.namespaceHook);

    // Code widget hook
    this.codeWidgetHook = new CodeWidgetHook();
    this.system.addHook(this.codeWidgetHook);

    // Document editor hook
    this.documentEditorHook = new DocumentEditorHook();
    this.system.addHook(this.documentEditorHook);

    // Command hook
    this.commandHook = new CommandHook(
      this.readOnlyMode,
      this.scriptCommands,
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

    this.slashCommandHook = new SlashCommandHook(this.client);

    // MQ hook
    this.system.addHook(new MQHook(this.system, this.mq));

    // Syscall hook
    this.system.addHook(new SyscallHook());

    this.eventHook.addLocalListener(
      "file:changed",
      async (path: string, _oldHash, newHash) => {
        // Plug (re)loading
        if (
          !path.startsWith(plugPrefix) ||
          !path.endsWith(".plug.js") ||
          this.client.bootConfig.disablePlugs
        ) {
          return;
        }

        console.log("Plug updated, reloading", path);

        await this.system.loadPlug(
          createWorkerSandboxFromLocalPath(path),
          path,
          newHash,
        );
      },
    );
  }

  init() {
    // Init is called after the editor is initialized, so we can safely add the command hook
    this.system.addHook(this.commandHook);
    this.system.addHook(this.slashCommandHook);

    // Syscalls available to all plugs
    this.system.registerSyscalls(
      [],
      eventSyscalls(this.eventHook),
      eventListenerSyscalls(this.client),
      editorSyscalls(this.client),
      spaceReadSyscalls(this.client),
      systemSyscalls(client, false),
      markdownSyscalls(client),
      assetSyscalls(this.system),
      yamlSyscalls(),
      codeWidgetSyscalls(this.codeWidgetHook),
      clientCodeWidgetSyscalls(),
      languageSyscalls(),
      jsonschemaSyscalls(),
      indexSyscalls(client),
      //commandSyscalls(client),
      luaSyscalls(this),
      mqSyscalls(this.mq),
      dataStoreReadSyscalls(this.ds, this),
      dataStoreWriteSyscalls(this.ds),
      syncSyscalls(this.client),
      clientStoreSyscalls(this.ds),
      configSyscalls(this.client.config),
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

  async loadScripts() {
    if (this.client.bootConfig.disableSpaceLua) {
      console.info("Space Lua scripts are disabled, skipping loading scripts");
      return;
    }
    if (!await this.hasFullIndexCompleted()) {
      console.info(
        "Not loading space scripts, since initial indexing has not completed yet",
      );
      return;
    }
    this.client.config.clear();
    try {
      await this.spaceLuaEnv.reload();
    } catch (e: any) {
      console.error("Error loading Lua script:", e.message);
    }

    // Reset the space script commands
    this.scriptCommands.clear();
    for (
      const [name, command] of Object.entries(
        this.client.config.get<Record<string, Command>>("commands", {}),
      )
    ) {
      this.scriptCommands.set(name, command);
    }

    // Make scripted (slash) commands available
    this.commandHook.throttledBuildAllCommandsAndEmit();
    this.slashCommandHook.throttledBuildAllCommands();

    this.scriptsLoaded = true;
  }

  async reloadPlugsFromSpace(space: Space) {
    console.log("(Re)loading plugs");
    await this.system.unloadAll();

    let allPlugs = await space.listPlugs();
    if (this.client.bootConfig.disablePlugs) {
      // Only keep builtin plugs
      allPlugs = allPlugs.filter(({ name }) => builtinPlugPaths.includes(name));

      console.warn("Not loading custom plugs as `disablePlugs` has been set");
    }

    await Promise.all(allPlugs.map((fileMeta) =>
      this.system.loadPlug(
        createWorkerSandboxFromLocalPath(fileMeta.name),
        fileMeta.name,
        fileMeta.lastModified,
      ).catch((e) =>
        console.error(
          `Could not load plug ${fileMeta.name} error: ${e.message}`,
        )
      )
    ));
  }

  localSyscall(name: string, args: any[]) {
    return this.system.localSyscall(name, args);
  }

  queryLuaObjects<T>(tag: string, query: LuaCollectionQuery): Promise<T[]> {
    return this.system.invokeFunction("index.queryLuaObjects", [tag, query]);
  }

  getObjectByRef<T>(page: string, tag: string, ref: string) {
    return this.localSyscall(
      "system.invokeFunction",
      ["index.getObjectByRef", page, tag, ref],
    );
  }

  async isIndexOngoing() {
    return !!(await this.ds.get(indexQueuedKey));
  }

  async setIndexOngoing(val: boolean = true) {
    await this.ds.set(indexQueuedKey, val);
  }

  async ensureFullIndex() {
    if (!this.client.fullSyncCompleted) {
      console.info(
        "Initial full sync not completed, skipping index check",
      );
      return;
    }
    const currentIndexVersion = await this.getCurrentIndexVersion();

    if (!currentIndexVersion) {
      console.log("No index version found, assuming fresh install");
      await this.markFullSpaceIndexComplete();
      return;
    }

    console.info(
      "[index]",
      "Current space index version",
      currentIndexVersion,
      "index ongoing?",
      await this.isIndexOngoing(),
    );

    if (
      currentIndexVersion !== desiredIndexVersion &&
      !await this.isIndexOngoing()
    ) {
      console.info(
        "[index]",
        "Performing a full space reindex, this could take a while...",
      );
      await this.setIndexOngoing();
      await this.system.invokeFunction("index.reindexSpace", []);
      console.info("[index]", "Full space index complete.");
      await this.markFullSpaceIndexComplete();
      await this.setIndexOngoing(false);
      // Let's load space scripts again, which probably weren't loaded before
      await this.reloadState();
    }
  }

  public async reloadState() {
    console.log(
      "Now loading space scripts, custom styles and rebuilding editor state",
    );
    await this.loadScripts();
    await this.client.loadCustomStyles();
    this.client.rebuildEditorState();
  }

  public async evalLuaFunction(
    luaFunction: ILuaFunction,
    args: LuaValue[],
  ): Promise<LuaValue> {
    const tl = await buildThreadLocalEnv(
      this.system,
      this.spaceLuaEnv.env,
    );
    const sf = new LuaStackFrame(tl, null);
    try {
      return luaValueToJS(
        await luaCall(luaFunction, args.map(jsToLuaValue), {}, sf),
        sf,
      );
    } catch (e: any) {
      await handleLuaError(e, this.system);
    }
  }

  public async hasFullIndexCompleted() {
    return (await this.ds.get(indexVersionKey)) === desiredIndexVersion;
  }

  private getCurrentIndexVersion() {
    return this.ds.get(indexVersionKey);
  }

  async markFullSpaceIndexComplete() {
    await this.ds.set(indexVersionKey, desiredIndexVersion);
  }
}
