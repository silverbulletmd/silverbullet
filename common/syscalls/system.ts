import type { SyscallMeta } from "../../plug-api/types.ts";
import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type { Client } from "../../web/client.ts";
import type { CommandDef } from "$lib/command.ts";
import { version } from "../../version.ts";
import { deleteDB } from "idb";

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
    "system.reloadConfig": (): Record<string, any> => {
      console.warn("system.reloadConfig is deprecated, it's now a no-op");
      return client.config.values;
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
    "system.wipeClient": async (_ctx, logout = false) => {
      // Two tracks:
      // 1. Service worker unregister
      // 2. IndexedDB cleaning
      if (navigator.serviceWorker) {
        const registration = await navigator.serviceWorker.ready;

        if (registration?.active) {
          // Disconnect the datastore in the service worker first
          registration.active.postMessage({ type: "shutdown" });
          // Then flush the cache
          registration.active.postMessage({ type: "flushCache" });
          await new Promise<void>((resolve) => {
            navigator.serviceWorker.addEventListener("message", (event) => {
              if (event.data.type === "cacheFlushed") {
                console.log("Cache flushed");
                navigator.serviceWorker.getRegistrations().then(
                  async (registrations) => {
                    for (const registration of registrations) {
                      await registration.unregister();
                    }
                    resolve();
                  },
                );
              }
            });
          });
        } else {
          console.info("No service worker active, so not unregistering");
        }
      } else {
        console.info("Service workers not supported, so not unregistering");
      }
      console.log("Stop all the systems");
      client.space.unwatch();
      client.syncService.close();
      client.ds.kv.close();
      if (indexedDB.databases) {
        // get a list of all existing IndexedDB databases
        const databases = await indexedDB.databases();
        // loop through the list and delete each database
        for (const database of databases) {
          console.log("Deleting database", database.name);
          await deleteDB(database.name!);
        }
      } else {
        // Firefox doesn't support indexedDB.databases :(
        console.info(
          "Cannot delete local database, so go to empty them instead",
        );
        const allKeys = [];
        for await (
          const { key } of client.ds.kv.query({})
        ) {
          allKeys.push(key);
        }
        await client.ds.batchDelete(allKeys);
      }
      if (logout) {
        location.href = "/.logout";
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
      return version;
    },
    "system.getConfig": (_ctx, key: string, defaultValue: any = undefined) => {
      return client.config.get(key, defaultValue);
    },
  };
  return api;
}
