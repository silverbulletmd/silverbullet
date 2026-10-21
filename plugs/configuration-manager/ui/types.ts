export type CommandOverride = {
  key?: string | string[];
  mac?: string | string[];
};

export type PendingShortcuts = Record<string, CommandOverride>;

export type ConfigurationViewModel = {
  schemas: Record<string, any>;
  values: Record<string, any>;
  categories: Record<
    string,
    { name: string; description?: string; priority?: number }
  >;
  commands: Record<string, any>;
  commandOverrides: Record<string, CommandOverride>;
  configOverrides: Record<string, any>;
  /** Set when CONFIG's managed block is not valid Lua; saving is refused */
  managedBlockError?: string;
  isMac: boolean;
  initialTab: TabId;
};

export type TabId = "configuration" | "shortcuts";
