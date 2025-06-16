import type { CommandDef, SlashCommandDef } from "$lib/manifest.ts";
import type { SlashCompletions } from "@silverbulletmd/silverbullet/types";

export type RunnableCommand = {
  run?: (args?: any[]) => Promise<void>;
};

export type Command = CommandDef & RunnableCommand;
export type SlashCommand = SlashCommandDef & {
  run: (...args: any[]) => Promise<SlashCompletions>;
};

export type CommandHookEvents = {
  commandsUpdated(commands: Map<string, Command>): void;
};

// TODO: Move this elsewhere
export function isValidEditor(
  currentEditor: string | undefined,
  requiredEditor: string | undefined,
): boolean {
  return (requiredEditor === undefined) ||
    (currentEditor === undefined &&
      requiredEditor === "page") ||
    (requiredEditor === "any") ||
    (currentEditor === requiredEditor) ||
    (currentEditor !== undefined && requiredEditor === "notpage");
}
