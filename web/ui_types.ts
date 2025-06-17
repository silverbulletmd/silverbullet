import type { Command } from "../type/command.ts";
import type { FilterOption, Notification, PanelMode } from "../type/client.ts";

import type { DocumentMeta, PageMeta } from "../type/index.ts";

export type PanelConfig = {
  mode?: PanelMode;
  html?: string;
  script?: string;
};

export type AppViewState = {
  current?:
    | {
      kind: "page";
      meta: PageMeta;
      path: string;
    }
    | {
      kind: "document";
      meta: DocumentMeta;
      path: string;
    };

  allPages: PageMeta[];
  allDocuments: DocumentMeta[];

  isLoading: boolean;
  isMobile: boolean;
  showPageNavigator: boolean;
  showCommandPalette: boolean;
  showCommandPaletteContext?: string;
  unsavedChanges: boolean;
  syncFailures: number; // Reset everytime a sync succeeds

  // Progress tracker
  progressPercentage?: number; // Used to show progress circle
  progressType?: string; // Used for styling

  panels: { [key: string]: PanelConfig };
  commands: Map<string, Command>;
  notifications: Notification[];
  recentCommands: Map<string, Date>;

  uiOptions: {
    vimMode: boolean;
    darkMode?: boolean;
    forcedROMode: boolean;
    customStyles?: string;
  };

  // Page navigator mode
  pageNavigatorMode: "page" | "meta" | "document" | "all";

  // Filter box
  showFilterBox: boolean;
  filterBoxLabel: string;
  filterBoxPlaceHolder: string;
  filterBoxOptions: FilterOption[];
  filterBoxHelpText: string;
  filterBoxOnSelect: (option: FilterOption | undefined) => void;

  // Prompt
  showPrompt: boolean;
  promptMessage?: string;
  promptDefaultValue?: string;
  promptCallback?: (value: string | undefined) => void;

  // Confirm
  showConfirm: boolean;
  confirmMessage?: string;
  confirmCallback?: (value: boolean) => void;
};

export const initialViewState: AppViewState = {
  isLoading: false,
  showPageNavigator: false,
  showCommandPalette: false,
  pageNavigatorMode: "page",
  unsavedChanges: false,
  syncFailures: 0,
  uiOptions: {
    vimMode: false,
    darkMode: undefined,
    forcedROMode: false,
  },
  isMobile: false,
  panels: {
    lhs: {},
    rhs: {},
    bhs: {},
    modal: {},
  },
  allPages: [],
  allDocuments: [],
  commands: new Map(),
  recentCommands: new Map(),
  notifications: [],
  showFilterBox: false,
  filterBoxHelpText: "",
  filterBoxLabel: "",
  filterBoxOnSelect: () => {
  },
  filterBoxOptions: [],
  filterBoxPlaceHolder: "",

  showPrompt: false,
  showConfirm: false,
};

export type Action =
  | { type: "page-loaded"; meta: PageMeta }
  | { type: "page-loading"; name: string }
  | { type: "page-changed" }
  | { type: "page-saved" }
  | { type: "document-editor-loaded"; meta: DocumentMeta }
  | { type: "document-editor-loading"; name: string }
  | { type: "document-editor-changed" }
  | { type: "document-editor-saved" }
  | { type: "sync-change"; syncSuccess: boolean }
  | { type: "update-current-page-meta"; meta: PageMeta }
  | { type: "update-page-list"; allPages: PageMeta[] }
  | { type: "update-document-list"; allDocuments: DocumentMeta[] }
  | { type: "start-navigate"; mode: "page" | "meta" | "document" | "all" }
  | { type: "stop-navigate" }
  | {
    type: "update-commands";
    commands: Map<string, Command>;
  }
  | { type: "show-palette"; context?: string }
  | { type: "hide-palette" }
  | { type: "show-notification"; notification: Notification }
  | { type: "dismiss-notification"; id: number }
  | {
    type: "show-panel";
    id: "rhs" | "lhs" | "bhs" | "modal";
    config: PanelConfig;
  }
  | { type: "hide-panel"; id: string }
  | { type: "command-run"; command: string }
  | {
    type: "show-filterbox";
    options: FilterOption[];
    placeHolder: string;
    helpText: string;
    label: string;
    onSelect: (option: FilterOption | undefined) => void;
  }
  | { type: "hide-filterbox" }
  | {
    type: "show-prompt";
    message: string;
    defaultValue: string;
    callback: (value: string | undefined) => void;
  }
  | { type: "hide-prompt" }
  | {
    type: "show-confirm";
    message: string;
    callback: (value: boolean) => void;
  }
  | { type: "hide-confirm" }
  | { type: "set-ui-option"; key: string; value: any }
  | {
    type: "set-progress";
    progressPercentage?: number;
    progressType?: string;
  };
