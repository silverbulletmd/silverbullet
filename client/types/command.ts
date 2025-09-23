import type {
  CommandDef,
  SlashCommandDef,
} from "@silverbulletmd/silverbullet/type/manifest";

import type { SlashCompletions } from "@silverbulletmd/silverbullet/type/client";

export type Command = CommandDef & {
  run?: (args?: any[]) => Promise<void>;
};

export type SlashCommand = SlashCommandDef & {
  run: (...args: any[]) => Promise<SlashCompletions>;
};

export type CommandHookEvents = {
  commandsUpdated(commands: Map<string, Command>): void;
};
