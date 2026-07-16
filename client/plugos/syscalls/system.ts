import type { SysCallMapping } from "../system.ts";
import type { Client } from "../../client.ts";
import { version as publicVersion } from "../../../version.json";
import type { CommandDef } from "@silverbulletmd/silverbullet/type/manifest";
import type { SyscallMeta } from "@silverbulletmd/silverbullet/type/index";

export function systemSyscalls(
  client: Client,
  readOnlyMode: boolean,
): SysCallMapping {
  const api: SysCallMapping = {
    "system.invokeFunction": {
      callback: (
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
      description: "Invokes a loaded plug function by its plug-qualified name.",
      signatures: ["system.invokeFunction(name, ...)"],
    },
    "system.invokeFunctionOnServer": {
      callback: (
        ctx,
        fullName: string, // plug.function
        ...args: any[]
      ) => {
        console.warn(
          "Calling deprecated system.invokeFunctionOnServer, use system.invokeFunction instead",
        );
        const registration = api["system.invokeFunction"];
        const invokeFunction =
          typeof registration === "function"
            ? registration
            : registration.callback;
        return invokeFunction(ctx, fullName, ...args);
      },
      description: "Deprecated alias for system.invokeFunction.",
      deprecated: "Use system.invokeFunction instead.",
      signatures: ["system.invokeFunctionOnServer(name, ...)"],
    },
    "system.serverSyscall": {
      callback: (_ctx, name: string, ...args: any[]) => {
        console.warn(
          "Calling deprecated system.serverSyscall, use syscall instead",
        );
        return client.clientSystem.localSyscall(name, args);
      },
      description: "Deprecated helper for invoking a named syscall.",
      deprecated: "Invoke the target syscall directly instead.",
      signatures: ["system.serverSyscall(name, ...)"],
    },
    "system.invokeCommand": {
      callback: (_ctx, name: string, args?: string[]) => {
        console.warn("Deprecated, use editor.invokeCommand instead");
        return client.runCommandByName(name, args);
      },
      description: "Deprecated alias for editor.invokeCommand.",
      deprecated: "Use editor.invokeCommand instead.",
      signatures: ["system.invokeCommand(name, args?)"],
    },
    "system.listCommands": {
      callback: (): { [key: string]: CommandDef } => {
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
            requireEditor: def.requireEditor,
            menu: def.menu,
            menuMac: def.menuMac,
            menuWindows: def.menuWindows,
            menuLinux: def.menuLinux,
          };
        }
        return allCommands;
      },
      description:
        "Returns a map of every currently available command definition.",
    },
    "system.listSyscalls": {
      callback: (): SyscallMeta[] => {
        const syscalls: SyscallMeta[] = [];
        for (const [name, info] of client.clientSystem.system
          .registeredSyscalls) {
          const { callback, requiredPermissions, ...metadata } = info;
          syscalls.push({
            name,
            requiredPermissions,
            argCount: Math.max(0, callback.length - 1),
            ...metadata,
          });
        }
        return syscalls;
      },
      description:
        "Lists registered syscalls with permissions, argument counts, and documentation metadata.",
    },
    "system.reloadPlugs": {
      callback: () => {
        if (!client) {
          throw new Error("Not supported");
        }
        return client.loadPlugs();
      },
      description: "Reloads every plug available to the client.",
    },
    "system.reboot": {
      callback: async () => {
        await client.save(true);
        await client.eventedSpacePrimitives.fetchFileListWhenIdle();
        await client.mq.awaitEmptyQueue("indexQueue");
        await client.clientSystem.reloadState();
      },
      description:
        "Saves the current editor buffer, detects on-disk changes, waits for indexing, and reloads configuration, scripts, styles, and client state. Because the buffer is saved first, an external edit to the currently open page can be overwritten; edit that page through the editor or navigate away first.",
    },
    "system.loadPlug": {
      callback: async (_ctx, path: string) => {
        const meta = await client.space.spacePrimitives.getFileMeta(path);
        await client.clientSystem.loadPlugFromPath(path, meta.lastModified);
        await client.dispatchAppEvent("plugs:loaded");
      },
      description: "Loads or reloads one plug from a space file path.",
      signatures: ["system.loadPlug(path)"],
    },
    "system.unloadPlug": {
      callback: (_ctx, path: string) =>
        client.clientSystem.system.unloadByPath(path),
      description: "Unloads the plug loaded from a space file path.",
      signatures: ["system.unloadPlug(path)"],
    },
    "system.reloadConfig": {
      callback: (): Record<string, any> => {
        console.warn("system.reloadConfig is deprecated, it's now a no-op");
        return client.config.values;
      },
      description: "Deprecated no-op that returns the current configuration.",
      deprecated:
        "Configuration reloads automatically; use system.reboot when needed.",
    },
    "system.loadSpaceScripts": {
      callback: async () => {
        console.warn("DEPRECATED: used system.loadScripts instead");
        await client.clientSystem.loadLuaScripts();
      },
      description: "Deprecated alias for system.loadScripts.",
      deprecated: "Use system.loadScripts instead.",
    },
    "system.loadScripts": {
      callback: async () => {
        await client.clientSystem.loadLuaScripts();
      },
      description: "Reloads Space Lua scripts and configuration.",
    },
    "system.loadSpaceStyles": {
      callback: async () => {
        if (!client) {
          throw new Error("Not supported on server");
        }
        await client.loadCustomStyles();
      },
      description: "Reloads custom Space Style definitions.",
    },
    "system.wipeClient": {
      callback: async (_ctx, logout = false) => {
        await client.wipeClient();
        if (logout) {
          location.href = ".logout";
        } else {
          alert("Client wiped, feel free to navigate elsewhere");
        }
      },
      description:
        "Wipes local client state, cached files, databases, and optionally the login session.",
      signatures: ["system.wipeClient(logout?)"],
    },
    // DEPRECATED
    "system.cleanDatabases": {
      callback: (): boolean => {
        console.warn(
          "system.cleanDatabses is deprecated, use Client: Wipe instead",
        );
        return false;
      },
      description: "Deprecated no-op retained for compatibility.",
      deprecated: "Use system.wipeClient or the Client: Wipe command instead.",
    },
    "system.getMode": {
      callback: () => (readOnlyMode ? "ro" : "rw"),
      description: "Returns rw for read-write mode or ro for read-only mode.",
    },
    "system.getURLPrefix": {
      callback: () => {
        const url = new URL(document.baseURI);
        return url.pathname;
      },
      description:
        "Returns the configured URL path prefix for this SilverBullet instance.",
    },
    "system.getBaseURI": {
      callback: () => document.baseURI,
      description:
        "Returns the browser base URI for this SilverBullet instance.",
    },
    "system.getVersion": {
      callback: () => publicVersion,
      description: "Returns the running SilverBullet version.",
    },
    "system.getConfig": {
      callback: (_ctx, key: string, defaultValue: any = undefined) =>
        client.config.get(key, defaultValue),
      description: "Returns a configuration value, with an optional default.",
      signatures: ["system.getConfig(key, defaultValue?)"],
    },
    // DEPRECATED
    "system.getEnv": {
      callback: () => {
        console.warn(
          "system.getEnv is deprecated, you can assume the env to always be the client",
        );
        return null;
      },
      description: "Deprecated environment probe that always returns nil.",
      deprecated: "The environment is always the client.",
    },
    "system.getSpaceConfig": {
      callback: (_ctx, key, defaultValue?) => {
        console.warn(
          "system.getSpaceConfig is deprecated, use system.getConfig instead",
        );
        return client.config.get(key, defaultValue);
      },
      description: "Deprecated alias for system.getConfig.",
      deprecated: "Use system.getConfig instead.",
      signatures: ["system.getSpaceConfig(key, defaultValue?)"],
    },
  };
  return api;
}
