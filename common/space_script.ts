// deno-lint-ignore-file ban-types
import { System } from "../plugos/system.ts";
import { ScriptObject } from "../plugs/index/script.ts";

export class ScriptEnvironment {
  functions: Record<string, Function> = {};

  // Public API
  registerFunction(name: string, fn: Function) {
    this.functions[name] = fn;
  }

  // Internal API
  evalScript(script: string) {
    try {
      Function("silverbullet", script)(this);
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
      this.evalScript(script.script);
    }
  }
}
