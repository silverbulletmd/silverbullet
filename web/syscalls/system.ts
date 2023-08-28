import type { Plug } from "../../plugos/plug.ts";
import { SysCallMapping, System } from "../../plugos/system.ts";
import type { Client } from "../client.ts";
import { CommandDef } from "../hooks/command.ts";
import { proxySyscall } from "./util.ts";

export function systemSyscalls(
  editor: Client,
  system: System<any>,
): SysCallMapping {
  const api: SysCallMapping = {
    "system.invokeFunction": (
      ctx,
      name: string,
      ...args: any[]
    ) => {
      if (!ctx.plug) {
        throw Error("No plug associated with context");
      }

      if (name === "server" || name === "client") {
        // Backwards compatibility mode (previously there was an 'env' argument)
        name = args[0];
        args = args.slice(1);
      }

      let plug: Plug<any> | undefined = ctx.plug;
      if (name.indexOf(".") !== -1) {
        // plug name in the name
        const [plugName, functionName] = name.split(".");
        plug = system.loadedPlugs.get(plugName);
        if (!plug) {
          throw Error(`Plug ${plugName} not found`);
        }
        name = functionName;
      }
      const functionDef = plug.manifest!.functions[name];
      if (!functionDef) {
        throw Error(`Function ${name} not found`);
      }
      if (functionDef.env && system.env && functionDef.env !== system.env) {
        // Proxy to another environment
        return proxySyscall(ctx, editor.remoteSpacePrimitives, name, args);
      }
      return plug.invoke(name, args);
    },
    "system.invokeCommand": (_ctx, name: string) => {
      return editor.runCommandByName(name);
    },
    "system.listCommands": (): { [key: string]: CommandDef } => {
      const allCommands: { [key: string]: CommandDef } = {};
      for (const [cmd, def] of editor.system.commandHook.editorCommands) {
        allCommands[cmd] = def.command;
      }
      return allCommands;
    },
    "system.reloadPlugs": () => {
      return editor.loadPlugs();
    },
    "system.getEnv": () => {
      return system.env;
    },
  };
  return api;
}
