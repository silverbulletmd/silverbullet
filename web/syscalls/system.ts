import type { Plug } from "../../plugos/plug.ts";
import { SysCallMapping, System } from "../../plugos/system.ts";
import type { Editor } from "../editor.tsx";
import { CommandDef } from "../hooks/command.ts";

export function systemSyscalls(
  editor: Editor,
  system: System<any>,
): SysCallMapping {
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

      let plug: Plug<any> | undefined = ctx.plug;
      if (name.indexOf(".") !== -1) {
        // plug name in the name
        const [plugName, functionName] = name.split(".");
        plug = system.loadedPlugs.get(plugName);
        if (!plug) {
          throw Error(`Plug ${plugName} not found`);
        }
        name = functionName;
      }
      return plug.invoke(name, args);
    },
    "system.invokeCommand": (_ctx, name: string) => {
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
    "system.getEnv": () => {
      return system.env;
    },
  };
}
