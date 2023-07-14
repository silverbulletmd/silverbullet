import { PlugNamespaceHook } from "../common/hooks/plug_namespace.ts";
import { Manifest, SilverBulletHooks } from "../common/manifest.ts";
import buildMarkdown from "../common/markdown_parser/parser.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { DexieKVStore } from "../plugos/lib/kv_store.dexie.ts";
import { createSandbox } from "../plugos/environments/webworker_sandbox.ts";

import assetSyscalls from "../plugos/syscalls/asset.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import { storeSyscalls } from "../plugos/syscalls/store.dexie_browser.ts";
import { SysCallMapping, System } from "../plugos/system.ts";
import type { Client } from "./client.ts";
import { CodeWidgetHook } from "./hooks/code_widget.ts";
import { CommandHook } from "./hooks/command.ts";
import { SlashCommandHook } from "./hooks/slash_command.ts";
import { clientStoreSyscalls } from "./syscalls/clientStore.ts";
import { debugSyscalls } from "./syscalls/debug.ts";
import { editorSyscalls } from "./syscalls/editor.ts";
import { sandboxFetchSyscalls } from "./syscalls/fetch.ts";
import { pageIndexSyscalls } from "./syscalls/index.ts";
import { markdownSyscalls } from "./syscalls/markdown.ts";
import { shellSyscalls } from "./syscalls/shell.ts";
import { spaceSyscalls } from "./syscalls/space.ts";
import { syncSyscalls } from "./syscalls/sync.ts";
import { systemSyscalls } from "./syscalls/system.ts";
import { yamlSyscalls } from "./syscalls/yaml.ts";
import { Space } from "./space.ts";
import {
  loadMarkdownExtensions,
  MDExt,
} from "../common/markdown_parser/markdown_ext.ts";

export class ClientSystem {
  system: System<SilverBulletHooks> = new System("client");
  commandHook: CommandHook;
  slashCommandHook: SlashCommandHook;
  namespaceHook: PlugNamespaceHook;
  indexSyscalls: SysCallMapping;
  codeWidgetHook: CodeWidgetHook;
  plugsUpdated = false;
  mdExtensions: MDExt[] = [];

  constructor(
    private editor: Client,
    private kvStore: DexieKVStore,
    private dbPrefix: string,
    private eventHook: EventHook,
  ) {
    this.system.addHook(this.eventHook);

    // Plug page namespace hook
    this.namespaceHook = new PlugNamespaceHook();
    this.system.addHook(this.namespaceHook);

    // Cron hook
    const cronHook = new CronHook(this.system);
    this.system.addHook(cronHook);

    this.indexSyscalls = pageIndexSyscalls(
      `${dbPrefix}_page_index`,
      globalThis.indexedDB,
    );

    // Code widget hook
    this.codeWidgetHook = new CodeWidgetHook();
    this.system.addHook(this.codeWidgetHook);

    // Command hook
    this.commandHook = new CommandHook();
    this.commandHook.on({
      commandsUpdated: (commandMap) => {
        this.editor.ui.viewDispatch({
          type: "update-commands",
          commands: commandMap,
        });
      },
    });
    this.system.addHook(this.commandHook);

    // Slash command hook
    this.slashCommandHook = new SlashCommandHook(this.editor);
    this.system.addHook(this.slashCommandHook);

    this.eventHook.addLocalListener("plug:changed", async (fileName) => {
      console.log("Plug updated, reloading:", fileName);
      this.system.unload(fileName);
      const plug = await this.system.load(
        new URL(`/${fileName}`, location.href),
        createSandbox,
      );
      if ((plug.manifest! as Manifest).syntax) {
        // If there are syntax extensions, rebuild the markdown parser immediately
        this.updateMarkdownParser();
      }
      this.plugsUpdated = true;
    });
    this.registerSyscalls();
  }

  registerSyscalls() {
    const storeCalls = storeSyscalls(this.kvStore);

    // Slash command hook
    this.slashCommandHook = new SlashCommandHook(this.editor);
    this.system.addHook(this.slashCommandHook);

    // Syscalls available to all plugs
    this.system.registerSyscalls(
      [],
      eventSyscalls(this.eventHook),
      editorSyscalls(this.editor),
      spaceSyscalls(this.editor),
      systemSyscalls(this.editor, this.system),
      markdownSyscalls(buildMarkdown(this.mdExtensions)),
      assetSyscalls(this.system),
      yamlSyscalls(),
      storeCalls,
      this.indexSyscalls,
      debugSyscalls(),
      syncSyscalls(this.editor),
      // LEGACY
      clientStoreSyscalls(storeCalls),
    );

    // Syscalls that require some additional permissions
    this.system.registerSyscalls(
      ["fetch"],
      sandboxFetchSyscalls(this.editor.remoteSpacePrimitives),
    );

    this.system.registerSyscalls(
      ["shell"],
      shellSyscalls(this.editor.remoteSpacePrimitives),
    );
  }

  async reloadPlugsFromSpace(space: Space) {
    console.log("Loading plugs");
    await space.updatePageList();
    await this.system.unloadAll();
    console.log("(Re)loading plugs");
    await Promise.all((await space.listPlugs()).map(async (plugName) => {
      try {
        await this.system.load(
          new URL(plugName, location.origin),
          createSandbox,
        );
      } catch (e: any) {
        console.error("Could not load plug", plugName, "error:", e.message);
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
    return this.system.localSyscall("[local]", name, args);
  }
}
