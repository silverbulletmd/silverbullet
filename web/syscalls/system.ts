import { SysCallMapping } from "../../plugos/system.ts";
import type { Editor } from "../editor.tsx";
import { CommandDef } from "../hooks/command.ts";

export function systemSyscalls(editor: Editor): SysCallMapping {
  return {
    "system.invokeFunction": (
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
    "system.invokeCommand": (ctx, name: string) => {
      return editor.runCommandByName(name);
    },
    "system.listCommands": (): { [key: string]: CommandDef } => {
      const allCommands: { [key: string]: CommandDef } = {};
      for (let [cmd, def] of editor.commandHook.editorCommands) {
        allCommands[cmd] = def.command;
      }
      return allCommands;
    },
    "system.reloadPlugs": () => {
      return editor.reloadPlugs();
    },
    "sandbox.getServerLogs": (ctx) => {
      return editor.space.proxySyscall(ctx.plug, "sandbox.getLogs", []);
    },
  };
}
