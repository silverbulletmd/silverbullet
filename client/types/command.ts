import type {
  CommandDef,
  SlashCommandDef,
} from "@silverbulletmd/silverbullet/type/manifest";

import type { SlashCompletions } from "@silverbulletmd/silverbullet/type/client";

export type Command = CommandDef & {
  run?: (args?: any[]) => Promise<any>;
  lastRun?: number;
};

/**
 * One row of the command palette, flattened for the navigator source that
 * draws it: no `run`, no manifest fields it never shows, and the key hint
 * already written the way this platform writes it.
 */
export type PaletteCommand = {
  name: string;
  priority: number;
  /** Epoch ms of the last run on this client, absent if never run. */
  lastRun?: number;
  /** Prettified key binding, e.g. `⌘K`. */
  hint?: string;
};

export type SlashCommand = SlashCommandDef & {
  run: (...args: any[]) => Promise<SlashCompletions>;
};

export type CommandHookEvents = {
  commandsUpdated(commands: Map<string, Command>): void;
};
