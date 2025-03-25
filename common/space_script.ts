import type { ParseTree } from "../plug-api/lib/tree.ts";
import type { AppCommand, CommandDef, SlashCommand } from "$lib/command.ts";
import type { SlashCommandDef } from "$lib/manifest.ts";

type FunctionDef = {
  name: string;
};

type AttributeExtractorDef = {
  tags: string[];
};

export type EventListenerDef = {
  name: string;
};

type AttributeExtractorCallback = (
  text: string,
  tree: ParseTree,
) => Record<string, any> | null | Promise<Record<string, any> | null>;

export class ScriptEnvironment {
  functions: Record<string, (...args: any[]) => any> = {};
  commands: Record<string, AppCommand> = {};
  slashCommands: Record<string, SlashCommand> = {};
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

  registerSlashCommand(
    def: SlashCommandDef,
    fn: (...args: any[]) => any,
  ) {
    this.slashCommands[def.name] = {
      slashCommand: def,
      run: fn,
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
}
