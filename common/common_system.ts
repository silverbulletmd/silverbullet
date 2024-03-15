import { AppCommand } from "$lib/command.ts";
import { CommandHook } from "./hooks/command.ts";
import { PlugNamespaceHook } from "$common/hooks/plug_namespace.ts";
import { SilverBulletHooks } from "../lib/manifest.ts";
import { buildQueryFunctions } from "./query_functions.ts";
import { ScriptEnvironment } from "./space_script.ts";
import { EventHook } from "./hooks/event.ts";
import { DataStore } from "$lib/data/datastore.ts";
import { System } from "$lib/plugos/system.ts";
import { CodeWidgetHook } from "../web/hooks/code_widget.ts";
import { PanelWidgetHook } from "../web/hooks/panel_widget.ts";
import { SlashCommandHook } from "../web/hooks/slash_command.ts";
import { DataStoreMQ } from "$lib/data/mq.datastore.ts";
import { ParseTree } from "../plug-api/lib/tree.ts";

const mqTimeout = 10000; // 10s
const mqTimeoutRetry = 3;

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
  scriptEnv: ScriptEnvironment = new ScriptEnvironment();

  constructor(
    protected mq: DataStoreMQ,
    protected ds: DataStore,
    protected eventHook: EventHook,
    public readOnlyMode: boolean,
    protected enableSpaceScript: boolean,
  ) {
    setInterval(() => {
      mq.requeueTimeouts(mqTimeout, mqTimeoutRetry, true).catch(console.error);
    }, 20000); // Look to requeue every 20s
  }

  async loadSpaceScripts() {
    let functions = buildQueryFunctions(
      this.allKnownPages,
      this.system,
    );
    if (this.enableSpaceScript) {
      this.scriptEnv = new ScriptEnvironment();
      try {
        await this.scriptEnv.loadFromSystem(this.system);
        console.log(
          "Loaded",
          Object.keys(this.scriptEnv.functions).length,
          "functions and",
          Object.keys(this.scriptEnv.commands).length,
          "commands from space-script",
        );
      } catch (e: any) {
        console.error("Error loading space-script:", e.message);
      }
      functions = { ...functions, ...this.scriptEnv.functions };

      // Reset the space script commands
      this.spaceScriptCommands.clear();
      for (const [name, command] of Object.entries(this.scriptEnv.commands)) {
        this.spaceScriptCommands.set(name, command);
      }

      // Inject the registered events in the event hook
      this.eventHook.scriptEnvironment = this.scriptEnv;

      this.commandHook.throttledBuildAllCommands();
    }
    // Swap in the expanded function map
    this.ds.functionMap = functions;
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
}
