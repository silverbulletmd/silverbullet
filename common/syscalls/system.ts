import { SysCallMapping, System } from "../../plugos/system.ts";
import type { ServerSystem } from "../../server/server_system.ts";
import type { Client } from "../../web/client.ts";
import { CommandDef } from "../../web/hooks/command.ts";
import { proxySyscall } from "../../web/syscalls/util.ts";

export function systemSyscalls(
  system: System<any>,
  readOnlyMode: boolean,
  client: Client | undefined,
  serverSystem: ServerSystem | undefined,
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
    "system.loadSpaceScripts": async () => {
      if (client) {
        // If this is invoked on the client, we need to load the space scripts locally
        await client.loadSpaceScripts();
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
      } else if (serverSystem) {
        return serverSystem.loadSpaceScripts();
      } else {
        throw new Error("Load space scripts in an undefined environment");
      }
    },
    "system.getEnv": () => {
      return system.env;
    },
    "system.getMode": () => {
      return readOnlyMode ? "ro" : "rw";
    },
  };
  return api;
}
