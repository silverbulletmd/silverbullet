export type CommandDef = {
  name: string;

  contexts?: string[];

  // Default 0, higher is higher priority = higher in the list
  priority?: number;

  // Bind to keyboard shortcut
  key?: string;
  mac?: string;

  hide?: boolean;
  requireMode?: "rw" | "ro";
};

export type AppCommand = {
  command: CommandDef;
  run: (args?: any[]) => Promise<void>;
};

export type CommandHookEvents = {
  commandsUpdated(commandMap: Map<string, AppCommand>): void;
};
