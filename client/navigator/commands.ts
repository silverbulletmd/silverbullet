import type { CommandHook } from "../plugos/hooks/command.ts";
import { openCommand } from "./navigator.ts";

/** The built-in navigator views that come with a command of their own. */
export function registerNavigatorCommands(hook: CommandHook): void {
  hook.registerCommand({
    name: "Navigate: Outline",
    run: openCommand("std.toc"),
  });
  hook.registerCommand({
    name: "Navigate: Outline Picker",
    run: openCommand("std.tocModal"),
  });
  hook.registerCommand({
    name: "Navigate: Tree",
    key: ["Ctrl-o", "Ctrl-Shift-o"],
    mac: ["Cmd-o", "Cmd-Shift-o"],
    run: openCommand("std.spaceTree"),
  });
}
