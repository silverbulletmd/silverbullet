import { System } from "../lib/plugos/system.ts";
import { ParseTree } from "../plug-api/lib/tree.ts";
import { ScriptObject } from "../plugs/index/script.ts";
import { AppCommand, CommandDef } from "$lib/command.ts";
import { Intl, Temporal, toTemporalInstant } from "@js-temporal/polyfill";

// @ts-ignore: Temporal polyfill
Date.prototype.toTemporalInstant = toTemporalInstant;
// @ts-ignore: Temporal polyfill
globalThis.Temporal = Temporal;
// @ts-ignore: Intl polyfill
Object.apply(globalThis.Intl, Intl);

type FunctionDef = {
  name: string;
};

type AttributeExtractorDef = {
  tags: string[];
};

type EventListenerDef = {
  name: string;
};

type AttributeExtractorCallback = (
  text: string,
  tree: ParseTree,
) => Record<string, any> | null | Promise<Record<string, any> | null>;

export class ScriptEnvironment {
  functions: Record<string, (...args: any[]) => any> = {};
  commands: Record<string, AppCommand> = {};
  attributeExtractors: Record<string, AttributeExtractorCallback[]> = {};
  eventHandlers: Record<string, ((...args: any[]) => any)[]> = {};

  // Public API

  // Register function
  registerFunction(def: FunctionDef, fn: (...args: any[]) => any): void;
  // Legacy invocation
  registerFunction(name: string, fn: (...args: any[]) => any): void;
  registerFunction(
    arg: string | FunctionDef,
    fn: (...args: any[]) => any,
  ): void {
    if (typeof arg === "string") {
      console.warn(
        "registerFunction with string is deprecated, use `{name: string}` instead",
      );
      arg = { name: arg };
    }
    if (this.functions[arg.name]) {
      console.warn(`Function ${arg.name} already registered, overwriting`);
    }
    this.functions[arg.name] = fn;
  }

  registerCommand(command: CommandDef, fn: (...args: any[]) => any) {
    this.commands[command.name] = {
      command,
      run: (...args: any[]) => {
        return new Promise((resolve) => {
          // Next tick
          setTimeout(() => {
            resolve(fn(...args));
          });
        });
      },
    };
  }

  registerAttributeExtractor(
    def: AttributeExtractorDef,
    callback: AttributeExtractorCallback,
  ) {
    for (const tag of def.tags) {
      if (!this.attributeExtractors[tag]) {
        this.attributeExtractors[tag] = [];
      }
      this.attributeExtractors[tag].push(callback);
    }
  }

  registerEventListener(
    def: EventListenerDef,
    callback: (...args: any[]) => any,
  ) {
    if (!this.eventHandlers[def.name]) {
      this.eventHandlers[def.name] = [];
    }
    this.eventHandlers[def.name].push(callback);
  }

  // Internal API
  evalScript(script: string, system: System<any>) {
    try {
      const fn = Function(
        "silverbullet",
        "syscall",
        script,
      );
      fn.call(
        {},
        this,
        (name: string, ...args: any[]) => system.syscall({}, name, args),
      );
    } catch (e: any) {
      throw new Error(
        `Error evaluating script: ${e.message} for script: ${script}`,
      );
    }
  }

  async loadFromSystem(system: System<any>) {
    if (!system.loadedPlugs.has("index")) {
      console.warn("Index plug not found, skipping loading space scripts");
      return;
    }
    const allScripts: ScriptObject[] = await system.invokeFunction(
      "index.queryObjects",
      ["space-script", {}],
    );
    for (const script of allScripts) {
      this.evalScript(script.script, system);
    }
  }
}
