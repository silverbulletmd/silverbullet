import { AppCommand, CommandHook } from "./hooks/command.ts";
import { PlugNamespaceHook } from "$common/hooks/plug_namespace.ts";
import { SilverBulletHooks } from "./manifest.ts";
import { buildQueryFunctions } from "./query_functions.ts";
import { ScriptEnvironment } from "./space_script.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { DataStore } from "$lib/datastore.ts";
import { System } from "../plugos/system.ts";
import { CodeWidgetHook } from "../web/hooks/code_widget.ts";
import { PanelWidgetHook } from "../web/hooks/panel_widget.ts";
import { SlashCommandHook } from "../web/hooks/slash_command.ts";
import { DataStoreMQ } from "$lib/mq.datastore.ts";

export abstract class CommonSystem {
  system!: System<SilverBulletHooks>;

  // Hooks
  commandHook!: CommandHook;
  slashCommandHook!: SlashCommandHook;
  namespaceHook!: PlugNamespaceHook;
  codeWidgetHook!: CodeWidgetHook;
  panelWidgetHook!: PanelWidgetHook;

  readonly allKnownPages = new Set<string>();
  readonly spaceScriptCommands = new Map<string, AppCommand>();

  constructor(
    protected mq: DataStoreMQ,
    protected ds: DataStore,
    protected eventHook: EventHook,
    public readOnlyMode: boolean,
    protected enableSpaceScript: boolean,
  ) {
    setInterval(() => {
      // Timeout after 5s, retries 3 times, otherwise drops the message (no DLQ)
      mq.requeueTimeouts(5000, 3, true).catch(console.error);
    }, 20000); // Look to requeue every 20s
  }

  async loadSpaceScripts() {
    let functions = buildQueryFunctions(
      this.allKnownPages,
      this.system,
    );
    const scriptEnv = new ScriptEnvironment();
    if (this.enableSpaceScript) {
      try {
        await scriptEnv.loadFromSystem(this.system);
        console.log(
          "Loaded",
          Object.keys(scriptEnv.functions).length,
          "functions and",
          Object.keys(scriptEnv.commands).length,
          "commands from space-script",
        );
      } catch (e: any) {
        console.error("Error loading space-script:", e.message);
      }
      functions = { ...functions, ...scriptEnv.functions };

      // Reset the space script commands
      this.spaceScriptCommands.clear();
      for (const [name, command] of Object.entries(scriptEnv.commands)) {
        this.spaceScriptCommands.set(name, command);
      }

      this.commandHook.throttledBuildAllCommands();
    }
    // Swap in the expanded function map
    this.ds.functionMap = functions;
  }
}
