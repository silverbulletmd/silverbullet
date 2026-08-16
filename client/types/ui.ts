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

export type PanelSlot = "lhs" | "rhs" | "bhs" | "modal";

export type PanelOptions = {
  key?: string; // stable identity → persistent iframe
  preload?: boolean; // mount hidden (requires key)
  events?: string[]; // client events forwarded into the iframe (requires key)
  /**
   * An opaque identity the caller can attach to this show, echoed back into
   * `KeyedPanelConfig`.
   */
  activationId?: string | number;
};

export type PanelConfig = {
  mode?: PanelMode;
  html?: HTMLElement | HTMLElement[] | string;
  script?: string;
};

export type KeyedPanelConfig = PanelConfig & {
  key: string;
  slot: PanelSlot;
  hidden: boolean;
  events: string[];
  activationId?: string | number;
  /**
   * Paint-gated reveal (modal only -- see `editor.showPanel`): `false` while
   * this activation's iframe hasn't yet signalled (`editor.panelReady`) that
   * its first real content has rendered, or the reveal timeout has elapsed.
   * `undefined` for anything that was never gated (a sidebar/bhs dock, or a
   * preload mount).
   */
  paintReady?: boolean;
};

export type AppViewState = {
  current?: {
    path: Path;
    meta: PageMeta | DocumentMeta;
  };

  allPages: PageMeta[];

  isLoading: boolean;
  isMobile: boolean;
  isStandalone: boolean;
  unsavedChanges: boolean;
  isOnline: boolean;

  progressPercentage?: number;
  progressType?: string;

  panels: { [key: string]: PanelConfig };
  keyedPanels: KeyedPanelConfig[];
  commands: Map<string, Command>;
  notifications: Notification[];

  uiOptions: {
    vimMode: boolean;
    darkMode?: boolean;
    markdownSyntaxRendering: boolean;
    forcedROMode: boolean;
    customStyles?: string;
  };

  showFilterBox: boolean;
  filterBoxLabel: string;
  filterBoxPlaceHolder: string;
  filterBoxOptions: FilterOption[];
  filterBoxHelpText: string;
  filterBoxOnSelect: (option: FilterOption | undefined) => void;

  showPrompt: boolean;
  promptMessage?: string;
  promptDefaultValue?: string;
  promptCallback?: (value: string | undefined) => void;

  showConfirm: boolean;
  confirmMessage?: string;
  confirmDestructive?: boolean;
  confirmCallback?: (value: boolean) => void;
};

export const initialViewState: AppViewState = {
  isLoading: false,
  unsavedChanges: false,
  isOnline: true,
  uiOptions: {
    vimMode: false,
    darkMode: undefined,
    markdownSyntaxRendering: false,
    forcedROMode: false,
  },
  isMobile: false,
  isStandalone: false,
  panels: {
    lhs: {},
    rhs: {},
    bhs: {},
    modal: {},
  },
  keyedPanels: [],
  allPages: [],
  commands: new Map(),

  notifications: [],
  showFilterBox: false,
  filterBoxHelpText: "",
  filterBoxLabel: "",
  filterBoxOnSelect: () => {},
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
  | {
      type: "update-commands";
      commands: Map<string, Command>;
    }
  | { type: "show-notification"; notification: Notification }
  | { type: "dismiss-notification"; id: number }
  | {
      type: "show-panel";
      id: "rhs" | "lhs" | "bhs" | "modal";
      config: PanelConfig;
    }
  | { type: "hide-panel"; id: string }
  | { type: "show-keyed-panel"; config: KeyedPanelConfig }
  | { type: "hide-keyed-panel"; key: string }
  | { type: "mark-panel-ready"; key: string }
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
      destructive?: boolean;
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
  syncDocuments?: boolean;
  syncIgnore?: string;
  // These are all configured via ?query parameters, e.g. ?disableSpaceLua=1
  disableSpaceLua?: boolean;
  disableSpaceStyle?: boolean;
  disablePlugs?: boolean;
  performWipe?: boolean;
  performReset?: boolean;

  enableClientEncryption: boolean;
  accountManaged?: boolean;
  disableServiceWorker?: boolean;
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
export type ServiceWorkerSourceMessage =
  | {
      type: "sync-status";
      status: Omit<SyncStatus, "snapshot">;
    }
  | {
      type: "sync-conflict";
      path: string;
    }
  | {
      type: "space-sync-complete";
      operations: number;
    }
  | {
      type: "file-sync-complete";
      path: string;
      operations: number;
    }
  | {
      type: "sync-error";
      message: string;
      path?: string;
    }
  | {
      type: "online-status";
      isOnline: boolean;
    }
  | {
      type: "auth-error";
      message: string;
      actionOrRedirectHeader: string;
    }
  | {
      type: "cacheFlushed";
    }
  | {
      type: "dataWiped";
    }
  | {
      type: "service-worker-started";
    }
  | {
      type: "encryption-key";
      key: string;
    }
  | {
      type: "server-version";
      serverVersion: string;
    };
