import type { SyscallMeta } from "../../plug-api/types.ts";
import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type { Client } from "../../web/client.ts";
import type { CommandDef } from "$lib/command.ts";
import { version } from "../../version.ts";

export function systemSyscalls(
  client: Client,
  readOnlyMode: boolean,
): SysCallMapping {
  const api: SysCallMapping = {
    "system.invokeFunction": (
      _ctx,
      fullName: string, // plug.function
      ...args: any[]
    ) => {
      const [plugName, functionName] = fullName.split(".");
      if (!plugName || !functionName) {
        throw Error(`Invalid function name ${fullName}`);
      }
      const plug = client.clientSystem.system.loadedPlugs.get(plugName);
      if (!plug) {
        throw Error(`Plug ${plugName} not found`);
      }
      const functionDef = plug.manifest!.functions[functionName];
      if (!functionDef) {
        throw Error(`Function ${functionName} not found`);
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
      const commandHook = client.clientSystem.commandHook;
      const allCommands: { [key: string]: CommandDef } = {};
      for (const [cmd, def] of commandHook.editorCommands) {
        allCommands[cmd] = {
          name: def.command.name,
          contexts: def.command.contexts,
          priority: def.command.priority,
          key: def.command.key,
          mac: def.command.mac,
          hide: def.command.hide,
          requireMode: def.command.requireMode,
        };
      }
      return allCommands;
    },
    "system.listSyscalls": (): SyscallMeta[] => {
      const syscalls: SyscallMeta[] = [];
      for (
        const [name, info] of client.clientSystem.system.registeredSyscalls
      ) {
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
      await client.clientSystem.loadSpaceScripts();
    },
    "system.loadSpaceStyles": async () => {
      if (!client) {
        throw new Error("Not supported on server");
      }
      await client.loadCustomStyles();
    },
    "system.getMode": () => {
      return readOnlyMode ? "ro" : "rw";
    },
    "system.getVersion": () => {
      return version;
    },
    "system.getConfig": (_ctx, key: string, defaultValue: any = undefined) => {
      return client.config.get(key, defaultValue);
    },
  };
  return api;
}
