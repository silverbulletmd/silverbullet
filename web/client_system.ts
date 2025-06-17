import { PlugNamespaceHook } from "./hooks/plug_namespace.ts";
import type { SilverBulletHooks } from "../lib/manifest.ts";
import type { EventHook } from "./hooks/event.ts";
import { createSandbox } from "../lib/plugos/sandboxes/web_worker_sandbox.ts";

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

const plugNameExtractRegex = /\/(.+)\.plug\.js$/;
const indexVersionKey = ["$indexVersion"];
// Bump this one every time a full reindex is needed
const desiredIndexVersion = 7;
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

  readonly allKnownFiles = new Set<string>();
  readonly scriptCommands = new Map<string, Command>();
  spaceLuaEnv = new SpaceLuaEnvironment();
  scriptsLoaded: boolean = false;
  private indexOngoing = false;

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
      async (path: string, _selfUpdate, _oldHash, newHash) => {
        if (path.startsWith(plugPrefix) && path.endsWith(".plug.js")) {
          const plugName = plugNameExtractRegex.exec(path)![1];
          console.log("Plug updated, reloading", plugName, "from", path);
          this.system.unload(path);
          await this.system.load(
            plugName,
            createSandbox(new URL(`${path}`, document.baseURI)),
            newHash,
          );
        }
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
      configSyscalls(this.client),
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
    if (!await this.hasFullIndexCompleted()) {
      console.info(
        "Not loading space scripts, since initial indexing has not completed yet",
      );
      return;
    }
    this.client.config.clear();
    try {
      await this.spaceLuaEnv.reload(this.system);
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
    await this.system.unloadAll();
    console.log("(Re)loading plugs");
    const allPlugs = await space.listPlugs();
    await Promise.all(allPlugs.map(async (plugMeta) => {
      try {
        const plugName = plugNameExtractRegex.exec(plugMeta.name)![1];
        await this.system.load(
          plugName,
          createSandbox(
            new URL(
              plugMeta.name,
              document.baseURI, // We're NOT striping trailing '/', this used to be `location.origin`
            ),
          ),
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

  queryLuaObjects<T>(tag: string, query: LuaCollectionQuery): Promise<T[]> {
    return this.system.invokeFunction("index.queryLuaObjects", [tag, query]);
  }

  getObjectByRef<T>(page: string, tag: string, ref: string) {
    return this.localSyscall(
      "system.invokeFunction",
      ["index.getObjectByRef", page, tag, ref],
    );
  }

  async ensureFullIndex() {
    const currentIndexVersion = await this.getCurrentIndexVersion();

    console.info(
      "[index]",
      "Current space index version",
      currentIndexVersion,
      "index ongoing?",
      this.indexOngoing,
    );

    if (currentIndexVersion !== desiredIndexVersion && !this.indexOngoing) {
      console.info(
        "[index]",
        "Performing a full space reindex, this could take a while...",
      );
      this.indexOngoing = true;
      await this.system.invokeFunction("index.reindexSpace", []);
      console.info("[index]", "Full space index complete.");
      await this.markFullSpaceIndexComplete();
      this.indexOngoing = false;
      // Let's load space scripts again, which probably weren't loaded before
      console.log(
        "Now loading space scripts, custom styles and rebuilding editor state",
      );
      await this.loadScripts();
      await this.client.loadCustomStyles();
      this.client.rebuildEditorState();
    }
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

  private async markFullSpaceIndexComplete() {
    await this.ds.set(indexVersionKey, desiredIndexVersion);
  }
}
