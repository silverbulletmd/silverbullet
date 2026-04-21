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
    { name: string; description?: string; order?: number }
  >;
  commands: Record<string, any>;
  commandOverrides: Record<string, CommandOverride>;
  configOverrides: Record<string, any>;
  isMac: boolean;
  initialTab: "configuration" | "shortcuts";
};

export type TabId = "configuration" | "shortcuts";
