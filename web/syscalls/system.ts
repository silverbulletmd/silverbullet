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
      fullName: string, // plug.function
      ...args: any[]
    ) => {
      const [plugName, functionName] = fullName.split(".");
      if (!plugName || !functionName) {
        throw Error(`Invalid function name ${fullName}`);
      }
      const plug = system.loadedPlugs.get(plugName);
      if (!plug) {
        throw Error(`Plug ${plugName} not found`);
      }
      const functionDef = plug.manifest!.functions[functionName];
      if (!functionDef) {
        throw Error(`Function ${functionName} not found`);
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
      return plug.invoke(functionName, args);
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
