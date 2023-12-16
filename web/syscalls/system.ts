import type { Plug } from "../../plugos/plug.ts";
import { SysCallMapping, System } from "../../plugos/system.ts";
import type { Client } from "../client.ts";
import { CommandDef } from "../hooks/command.ts";
import { proxySyscall } from "./util.ts";

export function systemSyscalls(
  system: System<any>,
  client?: Client,
): SysCallMapping {
  const api: SysCallMapping = {
    "system.invokeFunction": (
      ctx,
      name: string,
      ...args: any[]
    ) => {
      if (name === "server" || name === "client") {
        // Backwards compatibility mode (previously there was an 'env' argument)
        name = args[0];
        args = args.slice(1);
      }

      let plug: Plug<any> | undefined = ctx.plug;
      const fullName = name;
      // console.log("Invoking function", fullName, "on plug", plug);
      if (name.includes(".")) {
        // plug name in the name
        const [plugName, functionName] = name.split(".");
        plug = system.loadedPlugs.get(plugName);
        if (!plug) {
          throw Error(`Plug ${plugName} not found`);
        }
        name = functionName;
      }
      const functionDef = plug?.manifest!.functions[name];
      if (!functionDef) {
        throw Error(`Function ${name} not found`);
      }
      if (
        client && functionDef.env && system.env &&
        functionDef.env !== system.env
      ) {
        // Proxy to another environment
        return proxySyscall(
          ctx,
          client.httpSpacePrimitives,
          "system.invokeFunction",
          [fullName, ...args],
        );
      }
      return plug.invoke(name, args);
    },
    "system.invokeCommand": (_ctx, name: string, args?: string[]) => {
      if (!client) {
        throw new Error("Not supported");
      }
      return client.runCommandByName(name, args);
    },
    "system.listCommands": (): { [key: string]: CommandDef } => {
      if (!client) {
        throw new Error("Not supported");
      }
      const allCommands: { [key: string]: CommandDef } = {};
      for (const [cmd, def] of client.system.commandHook.editorCommands) {
        allCommands[cmd] = def.command;
      }
      return allCommands;
    },
    "system.reloadPlugs": () => {
      if (!client) {
        throw new Error("Not supported");
      }
      return client.loadPlugs();
    },
    "system.getEnv": () => {
      return system.env;
    },
  };
  return api;
}
