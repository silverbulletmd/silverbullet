import { System } from "../lib/plugos/system.ts";
import { ScriptObject } from "../plugs/index/script.ts";
import { AppCommand, CommandDef } from "./hooks/command.ts";

export class ScriptEnvironment {
  functions: Record<string, (...args: any[]) => any> = {};
  commands: Record<string, AppCommand> = {};

  // Public API
  registerFunction(name: string, fn: (...args: any[]) => any) {
    this.functions[name] = fn;
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

  // Internal API
  evalScript(script: string, system: System<any>) {
    try {
      const fn = Function(
        "silverbullet",
        "syscall",
        "Deno",
        "window",
        "globalThis",
        "self",
        script,
      );
      fn.call(
        {},
        this,
        (name: string, ...args: any[]) => system.syscall({}, name, args),
        // The rest is explicitly left to be undefined to prevent access to the global scope
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
