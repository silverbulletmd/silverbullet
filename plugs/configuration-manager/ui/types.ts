import type { LibrariesViewModel } from "../libraries.ts";

export type CommandOverride = {
  key?: string | string[];
  mac?: string | string[];
};

export type PendingShortcuts = Record<string, CommandOverride>;

export type LibrariesFocus =
  | "manager"
  | "install"
  | "addRepository"
  | "updateAll"
  | "updateAllRepositories";

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
  initialTab: TabId;
  libraries: LibrariesViewModel;
  librariesFocus?: LibrariesFocus;
};

export type TabId = "configuration" | "shortcuts" | "libraries";
