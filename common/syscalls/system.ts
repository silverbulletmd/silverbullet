import { SyscallMeta } from "../../plug-api/types.ts";
import { SysCallMapping, System } from "../../lib/plugos/system.ts";
import type { Client } from "../../web/client.ts";
import { CommandDef } from "$lib/command.ts";
import { proxySyscall } from "../../web/syscalls/util.ts";
import type { CommonSystem } from "../common_system.ts";
import { version } from "../../version.ts";
import { ParseTree } from "../../plug-api/lib/tree.ts";

export function systemSyscalls(
  system: System<any>,
  readOnlyMode: boolean,
  commonSystem: CommonSystem,
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
      const commandHook = commonSystem!.commandHook;
      const allCommands: { [key: string]: CommandDef } = {};
      for (const [cmd, def] of commandHook.editorCommands) {
        allCommands[cmd] = def.command;
      }
      return allCommands;
    },
    "system.listSyscalls": (): SyscallMeta[] => {
      const syscalls: SyscallMeta[] = [];
      for (const [name, info] of system.registeredSyscalls) {
        syscalls.push({
          name,
          requiredPermissions: info.requiredPermissions,
          argCount: Math.max(0, info.callback.length - 1),
        });
      }
      return syscalls;
    },
    "system.reloadPlugs": () => {
      if (!client) {
        throw new Error("Not supported");
      }
      return client.loadPlugs();
    },
    "system.loadSpaceScripts": async () => {
      // Reload scripts locally
      await commonSystem.loadSpaceScripts();
      if (client) {
        // And we are in a hybrud mode, tell the server to do the same
        if (system.env === "client") {
          console.info(
            "Sending syscall to server to trigger space script reload",
          );
          await proxySyscall(
            {},
            client.httpSpacePrimitives,
            "system.loadSpaceScripts",
            [],
          );
        }
      }
    },
    "system.loadSpaceStyles": async () => {
      if (!client) {
        throw new Error("Not supported on server");
      }
      await client.loadCustomStyles();
    },
    "system.invokeSpaceFunction": (_ctx, name: string, ...args: any[]) => {
      return commonSystem.invokeSpaceFunction(name, args);
    },
    "system.applyAttributeExtractors": (
      _ctx,
      tags: string[],
      text: string,
      tree: ParseTree,
    ): Promise<Record<string, any>> => {
      return commonSystem.applyAttributeExtractors(tags, text, tree);
    },
    "system.getEnv": () => {
      return system.env;
    },
    "system.getMode": () => {
      return readOnlyMode ? "ro" : "rw";
    },
    "system.getVersion": () => {
      return version;
    },
  };
  return api;
}
