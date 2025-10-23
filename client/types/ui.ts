import type { Command } from "./command.ts";
import type {
  FilterOption,
  Notification,
  PanelMode,
} from "@silverbulletmd/silverbullet/type/client";

import type {
  DocumentMeta,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type { Path } from "@silverbulletmd/silverbullet/lib/ref";
import type { SyncStatus } from "../spaces/sync.ts";

export type PanelConfig = {
  mode?: PanelMode;
  html?: string;
  script?: string;
};

export type AppViewState = {
  current?: {
    path: Path;
    meta: PageMeta | DocumentMeta;
  };

  allPages: PageMeta[];
  allDocuments: DocumentMeta[];

  isLoading: boolean;
  isMobile: boolean;
  showPageNavigator: boolean;
  showCommandPalette: boolean;
  showCommandPaletteContext?: string;
  unsavedChanges: boolean;
  isOnline: boolean;

  // Progress tracker
  progressPercentage?: number; // Used to show progress circle
  progressType?: string; // Used for styling

  panels: { [key: string]: PanelConfig };
  commands: Map<string, Command>;
  notifications: Notification[];

  uiOptions: {
    vimMode: boolean;
    darkMode?: boolean;
    markdownSyntaxRendering: boolean;
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
  isOnline: true,
  uiOptions: {
    vimMode: false,
    darkMode: undefined,
    markdownSyntaxRendering: false,
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
  | { type: "page-loaded"; path: Path; meta: PageMeta }
  | { type: "page-changed" }
  | { type: "page-saved" }
  | { type: "document-editor-loaded"; path: Path; meta: DocumentMeta }
  | { type: "document-editor-changed" }
  | { type: "document-editor-saved" }
  | { type: "online-status-change"; isOnline: boolean }
  | { type: "update-current-page-meta"; meta: PageMeta }
  | { type: "update-page-list"; allPages: PageMeta[] }
  | { type: "update-document-list"; allDocuments: DocumentMeta[] }
  | { type: "start-navigate"; mode: "page" | "meta" | "document" | "all" }
  | { type: "stop-navigate" }
  | {
    type: "update-commands";
    commands: Map<string, Command>;
  }
  | { type: "show-palette"; context?: string; commands: Map<string, Command> }
  | { type: "hide-palette" }
  | { type: "show-notification"; notification: Notification }
  | { type: "dismiss-notification"; id: number }
  | {
    type: "show-panel";
    id: "rhs" | "lhs" | "bhs" | "modal";
    config: PanelConfig;
  }
  | { type: "hide-panel"; id: string }
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

/**
 * Client configuration that is set at boot time, doesn't change at runtime
 */
export type BootConfig = {
  spaceFolderPath: string;
  indexPage: string;
  readOnly: boolean;
  logPush?: boolean;
  // Sync configuration
  syncDocuments?: boolean;
  syncIgnore?: string;
  // These are all configured via ?query parameters, e.g. ?disableSpaceLua=1
  disableSpaceLua?: boolean;
  disableSpaceStyle?: boolean;
  disablePlugs?: boolean;
  performWipe?: boolean;
  performReset?: boolean;

  enableClientEncryption: boolean;
};

/**
 * Messages sent client -> service worker
 */
export type ServiceWorkerTargetMessage =
  | {
    type: "skip-waiting";
  }
  | { type: "config"; config: BootConfig }
  | { type: "flush-cache" }
  | { type: "shutdown" }
  | { type: "wipe-data" }
  | { type: "perform-file-sync"; path: string }
  | { type: "perform-space-sync" }
  | { type: "force-connection-status"; enabled: boolean }
  | { type: "get-encryption-key" }
  | { type: "set-encryption-key"; key: string };
/**
 * Events received from the service worker -> client
 */
export type ServiceWorkerSourceMessage = {
  type: "sync-status";
  status: Omit<SyncStatus, "snapshot">;
} | {
  type: "sync-conflict";
  path: string;
} | {
  type: "space-sync-complete";
  operations: number;
} | {
  type: "file-sync-complete";
  path: string;
  operations: number;
} | {
  type: "sync-error";
  message: string;
} | {
  type: "online-status";
  isOnline: boolean;
} | {
  type: "auth-error";
  message: string;
  actionOrRedirectHeader: string;
} | {
  type: "cacheFlushed";
} | {
  type: "dataWiped";
} | {
  type: "service-worker-started";
} | {
  type: "encryption-key";
  key: string;
};
