import { SysCallMapping } from "../../plugos/system.ts";
import type { Editor } from "../editor.tsx";
import { CommandDef } from "../hooks/command.ts";

export function systemSyscalls(editor: Editor): SysCallMapping {
  return {
    "system.invokeFunction": async (
      ctx,
      env: string,
      name: string,
      ...args: any[]
    ) => {
      if (!ctx.plug) {
        throw Error("No plug associated with context");
      }

      if (env === "client") {
        return ctx.plug.invoke(name, args);
      }

      return editor.space.invokeFunction(ctx.plug, env, name, args);
    },
    "system.invokeCommand": async (ctx, name: string) => {
      return editor.runCommandByName(name);
    },
    "system.listCommands": async (
      ctx,
    ): Promise<{ [key: string]: CommandDef }> => {
      let allCommands: { [key: string]: CommandDef } = {};
      for (let [cmd, def] of editor.commandHook.editorCommands) {
        allCommands[cmd] = def.command;
      }
      return allCommands;
    },
    "system.reloadPlugs": async () => {
      return editor.reloadPlugs();
    },

    "sandbox.getServerLogs": async (ctx) => {
      return editor.space.proxySyscall(ctx.plug, "sandbox.getLogs", []);
    },
  };
}
