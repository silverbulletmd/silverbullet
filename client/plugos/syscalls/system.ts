import type { SysCallMapping } from "../system.ts";
import type { Client } from "../../client.ts";
import { publicVersion } from "../../../public_version.ts";
import type { CommandDef } from "@silverbulletmd/silverbullet/type/manifest";
import type { SyscallMeta } from "@silverbulletmd/silverbullet/type/index";

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
    "system.invokeFunctionOnServer": (
      ctx,
      fullName: string, // plug.function
      ...args: any[]
    ) => {
      console.warn(
        "Calling deprecated system.invokeFunctionOnServer, use system.invokeFunction instead",
      );
      return api["system.invokeFunction"](ctx, fullName, ...args);
    },
    "system.serverSyscall": (_ctx, name: string, ...args: any[]) => {
      console.warn(
        "Calling deprecated system.serverSyscall, use syscall instead",
      );
      return client.clientSystem.localSyscall(name, args);
    },
    "system.invokeCommand": (_ctx, name: string, args?: string[]) => {
      console.warn("Deprecated, use editor.invokeCommand instead");
      return client.runCommandByName(name, args);
    },
    "system.listCommands": (): { [key: string]: CommandDef } => {
      const commandHook = client.clientSystem.commandHook;
      const allCommands: { [key: string]: CommandDef } = {};
      for (const [cmd, def] of commandHook.buildAllCommands()) {
        allCommands[cmd] = {
          name: def.name,
          contexts: def.contexts,
          priority: def.priority,
          key: def.key,
          mac: def.mac,
          hide: def.hide,
          requireMode: def.requireMode,
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
    "system.reloadConfig": (): Record<string, any> => {
      console.warn("system.reloadConfig is deprecated, it's now a no-op");
      return client.config.values;
    },
    "system.loadSpaceScripts": async () => {
      console.warn("DEPRECATED: used system.loadScripts instead");
      await client.clientSystem.loadLuaScripts();
    },
    "system.loadScripts": async () => {
      await client.clientSystem.loadLuaScripts();
    },
    "system.loadSpaceStyles": async () => {
      if (!client) {
        throw new Error("Not supported on server");
      }
      await client.loadCustomStyles();
    },
    "system.wipeClient": async (_ctx, logout = false) => {
      await client.wipeClient();
      if (logout) {
        location.href = ".logout";
      } else {
        alert("Client wiped, feel free to navigate elsewhere");
      }
    },
    "system.cleanDatabases": async (): Promise<boolean> => {
      // Determine current dbName
      const dbName = (client.ds.kv as any).dbName;
      const suffix = dbName.replace("sb_data", "");
      if (indexedDB.databases) {
        const allDbs = await indexedDB.databases();
        for (const db of allDbs) {
          if (!db.name?.endsWith(suffix)) {
            console.log("Deleting database", db.name);
            indexedDB.deleteDatabase(db.name!);
          }
        }
        return true;
      } else {
        return false;
      }
    },
    // DEPRECATED
    "system.getEnv": () => {
      console.warn(
        "system.getEnv is deprecated, you can assume the env to always be the client",
      );
      return null;
    },
    "system.getSpaceConfig": (_ctx, key, defaultValue?) => {
      console.warn(
        "system.getSpaceConfig is deprecated, use system.getConfig instead",
      );
      return client.config.get(key, defaultValue);
    },
    "system.getMode": () => {
      return readOnlyMode ? "ro" : "rw";
    },
    "system.getURLPrefix": () => {
      const url = new URL(document.baseURI);

      return url.pathname;
    },
    "system.getVersion": () => {
      return publicVersion;
    },
    "system.getConfig": (_ctx, key: string, defaultValue: any = undefined) => {
      return client.config.get(key, defaultValue);
    },
  };
  return api;
}
