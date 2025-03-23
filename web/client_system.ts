import { PlugNamespaceHook } from "$common/hooks/plug_namespace.ts";
import type { SilverBulletHooks } from "../lib/manifest.ts";
import type { EventHook } from "../common/hooks/event.ts";
import { createSandbox } from "../lib/plugos/sandboxes/web_worker_sandbox.ts";

import assetSyscalls from "../lib/plugos/syscalls/asset.ts";
import { eventSyscalls } from "../lib/plugos/syscalls/event.ts";
import { System } from "../lib/plugos/system.ts";
import type { Client } from "./client.ts";
import { CodeWidgetHook } from "./hooks/code_widget.ts";
import { CommandHook } from "$common/hooks/command.ts";
import { SlashCommandHook } from "./hooks/slash_command.ts";
import { SyscallHook } from "./hooks/syscall.ts";
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
import type { Space } from "../common/space.ts";
import { MQHook } from "../lib/plugos/hooks/mq.ts";
import { mqSyscalls } from "../lib/plugos/syscalls/mq.ts";
import {
  dataStoreReadSyscalls,
  dataStoreWriteSyscalls,
} from "../lib/plugos/syscalls/datastore.ts";
import type { DataStore } from "$lib/data/datastore.ts";
import { languageSyscalls } from "$common/syscalls/language.ts";
import { codeWidgetSyscalls } from "./syscalls/code_widget.ts";
import { clientCodeWidgetSyscalls } from "./syscalls/client_code_widget.ts";
import { KVPrimitivesManifestCache } from "$lib/plugos/manifest_cache.ts";
import { createKeyBindings } from "./editor_state.ts";
import type { DataStoreMQ } from "$lib/data/mq.datastore.ts";
import { plugPrefix } from "$common/spaces/constants.ts";
import { jsonschemaSyscalls } from "$common/syscalls/jsonschema.ts";
import { luaSyscalls } from "$common/syscalls/lua.ts";
import { indexSyscalls } from "$common/syscalls/index.ts";
import { commandSyscalls } from "$common/syscalls/command.ts";
import { eventListenerSyscalls } from "$common/syscalls/event.ts";
import { DocumentEditorHook } from "./hooks/document_editor.ts";
import type { LuaCollectionQuery } from "$common/space_lua/query_collection.ts";
import type { AppCommand } from "$lib/command.ts";
import { ScriptEnvironment } from "$common/space_script.ts";
import { SpaceLuaEnvironment } from "$common/space_lua.ts";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";

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
  readonly spaceScriptCommands = new Map<string, AppCommand>();
  scriptEnv: ScriptEnvironment = new ScriptEnvironment();
  spaceLuaEnv = new SpaceLuaEnvironment();
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
            createSandbox(new URL(`/${path}`, location.href)),
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
      eventListenerSyscalls(this),
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
      indexSyscalls(this.ds.kv),
      commandSyscalls(this),
      luaSyscalls(this),
      mqSyscalls(this.mq),
      dataStoreReadSyscalls(this.ds, this),
      dataStoreWriteSyscalls(this.ds),
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

  async loadSpaceScripts() {
    if (!await this.client.hasInitialSyncCompleted()) {
      console.info(
        "Not loading space scripts, since initial synca has not completed yet",
      );
      return;
    }
    this.scriptEnv = new ScriptEnvironment();
    try {
      await this.spaceLuaEnv.reload(this.system);
    } catch (e: any) {
      console.error("Error loading space-script:", e.message);
    }

    // Reset the space script commands
    this.spaceScriptCommands.clear();
    for (const [name, command] of Object.entries(this.scriptEnv.commands)) {
      this.spaceScriptCommands.set(name, command);
    }

    // Inject the registered events in the event hook
    this.eventHook.scriptEnvironment = this.scriptEnv;

    this.commandHook.throttledBuildAllCommands();
    this.slashCommandHook.throttledBuildAllCommands();

    this.scriptsLoaded = true;
  }

  invokeSpaceFunction(name: string, args: any[]) {
    const fn = this.scriptEnv.functions[name];
    if (!fn) {
      throw new Error(`Function ${name} not found`);
    }
    return fn(...args);
  }

  async applyAttributeExtractors(
    tags: string[],
    text: string,
    tree: ParseTree,
  ): Promise<Record<string, any>> {
    let resultingAttributes: Record<string, any> = {};
    for (const tag of tags) {
      const extractors = this.scriptEnv.attributeExtractors[tag];
      if (!extractors) {
        continue;
      }
      for (const fn of extractors) {
        const extractorResult = await fn(text, tree);
        if (extractorResult) {
          // Merge the attributes in
          resultingAttributes = {
            ...resultingAttributes,
            ...extractorResult,
          };
        }
      }
    }

    return resultingAttributes;
  }

  async reloadPlugsFromSpace(space: Space) {
    console.log("Loading plugs");
    await this.system.unloadAll();
    console.log("(Re)loading plugs");
    const allPlugs = await space.listPlugs();
    await Promise.all(allPlugs.map(async (plugMeta) => {
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

  queryLuaObjects<T>(tag: string, query: LuaCollectionQuery): Promise<T[]> {
    return this.system.invokeFunction("index.queryLuaObjects", [tag, query]);
  }

  getObjectByRef<T>(page: string, tag: string, ref: string) {
    return this.localSyscall(
      "system.invokeFunction",
      ["index.getObjectByRef", page, tag, ref],
    );
  }

  private indexOngoing = false;

  async ensureSpaceIndex() {
    const currentIndexVersion = await this.ds.get(indexVersionKey);

    console.info("Current space index version", currentIndexVersion);

    if (currentIndexVersion !== desiredIndexVersion && !this.indexOngoing) {
      console.info(
        "Performing a full space reindex, this could take a while...",
      );
      // First let's fetch all pages to make sure we have a cache of known pages
      // await this.client.space.fetchPageList();
      this.indexOngoing = true;
      await this.system.invokeFunction("index.reindexSpace", []);
      await this.system.invokeFunction("core.init", [true]); // initialSync = true
      console.info("Full space index complete.");
      await this.markFullSpaceIndexComplete(this.ds);
      this.indexOngoing = false;
      // Let's load space scripts again, which probably weren't loaded before
      console.log(
        "Now loading space scripts, custom styles and rebuilding editor state",
      );
      await this.loadSpaceScripts();
      await this.client.loadCustomStyles();
      this.client.rebuildEditorState();
    }
  }

  async markFullSpaceIndexComplete(ds: DataStore) {
    await ds.set(indexVersionKey, desiredIndexVersion);
  }
}
