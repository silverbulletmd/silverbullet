import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type { Client } from "../client.ts";
import { publicVersion } from "../../public_version.ts";
import type { CommandDef } from "../../lib/manifest.ts";
import type { SyscallMeta } from "../../type/index.ts";

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
      await client.clientSystem.loadScripts();
    },
    "system.loadScripts": async () => {
      await client.clientSystem.loadScripts();
    },
    "system.loadSpaceStyles": async () => {
      if (!client) {
        throw new Error("Not supported on server");
      }
      await client.loadCustomStyles();
    },
    "system.wipeClient": async (_ctx, logout = false) => {
      if (navigator.serviceWorker) {
        // We will attempt to unregister the service worker, best effort
        console.log("Getting service worker registrations");
        navigator.serviceWorker.getRegistrations().then(
          async (registrations) => {
            for (const registration of registrations) {
              await registration.unregister();
            }
            console.log("Unregistered all service workers");
          },
        );
      } else {
        console.info(
          "Service workers not enabled (no HTTPS?), so not unregistering.",
        );
      }
      console.log("Stopping all systems");
      client.space.unwatch();
      client.syncService.close();

      console.log("Clearing data store");
      await client.ds.kv.clear();
      console.log("Clearing complete. All done.");
      if (logout) {
        location.href = ".logout";
      } else {
        alert("Client wiped, feel free to navigate elsewhere");
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
    "system.getVersion": () => {
      return publicVersion;
    },
    "system.getConfig": (_ctx, key: string, defaultValue: any = undefined) => {
      return client.config.get(key, defaultValue);
    },
  };
  return api;
}
