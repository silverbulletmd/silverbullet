import type { Manifest as PlugosManifest } from "../../client/plugos/types.ts";
import type { NamespaceOperation } from "./namespace.ts";

export type CodeWidgetT = {
  codeWidget?: string;
  renderMode?: "iframe";
};

/**
 * Predefined native menu items. Ignored in PWA builds; used by the
 * SilverBullet desktop app to emit OS-native menu items (Cut/Copy/Paste,
 * Quit, About, etc.) instead of a command-dispatching item.
 */
export type PredefinedMenuKind =
  | "quit" | "about" | "services" | "hide" | "hideOthers" | "showAll"
  | "closeWindow" | "minimize" | "maximize" | "fullscreen"
  | "separator"
  | "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";

/**
 * A single native-menu placement for a command or submenu.
 * Desktop-app only; ignored in PWA builds.
 *
 * - `location`: id of the target menu or submenu (e.g. "file",
 *   "edit.format").
 * - `group`: sort-prefix convention "1_new", "2_dashboard", "9_close". Items
 *   are partitioned by group within a location; groups sort alphabetically
 *   with separators auto-inserted between them.
 * - `order`: ascending within a group; tiebreak by label.
 * - `label`: overrides the command's display label in the menu only.
 * - `predefined`: emit an OS-native predefined item instead of a
 *   command-dispatching item.
 * - `icon`: optional icon identifier; platform support varies.
 */
export type MenuContribution = {
  location: string;
  group?: string;
  order?: number;
  label?: string;
  predefined?: PredefinedMenuKind;
  icon?: string;
};

/**
 * A menu placement value: a single contribution, an array (multiple
 * placements), or `null` (hide this entry on the matching platform).
 * Desktop-app only.
 */
export type MenuPlacement = MenuContribution | MenuContribution[] | null;

export type CommandDef = {
  name: string;

  contexts?: string[];

  // Default 0, higher is higher priority = higher in the list
  priority?: number;

  // Bind to keyboard shortcut
  key?: string | string[];
  mac?: string | string[];

  hide?: boolean;
  requireMode?: "rw" | "ro";
  requireEditor?: "any" | "page" | "notpage" | string;

  // When true, this binding is NOT registered while vim mode is active,
  // so the key falls through to vim.
  disableInVim?: boolean;

  /**
   * Desktop-app only. Native menu placement for this command.
   *
   * Naming note: the existing `key`/`mac` pair uses a bare platform name
   * for the override. That pattern doesn't extend cleanly here — bare
   * `mac` is already taken by the keybinding override, and `windows` /
   * `linux` as top-level fields would be ambiguous. The `menu` + capital
   * platform suffix pattern keeps overrides unambiguous.
   */
  menu?: MenuPlacement;
  /** Platform-specific override: replaces `menu` on macOS. */
  menuMac?: MenuPlacement;
  /** Platform-specific override: replaces `menu` on Windows. */
  menuWindows?: MenuPlacement;
  /** Platform-specific override: replaces `menu` on Linux. */
  menuLinux?: MenuPlacement;
};
export type CommandHookT = {
  command?: CommandDef;
};

export type EventHookT = {
  events?: string[];
};

export type EventSubscriptionDef = {
  name: string;
};

type MQSubscription = {
  queue: string;
  batchSize?: number;
  pollInterval?: number;
  autoAck?: boolean;
};
export type MQHookT = {
  mqSubscriptions?: MQSubscription[];
};

export type PlugNamespaceDef = {
  pattern: string;
  operation: NamespaceOperation;
};

export type PlugNamespaceHookT = {
  pageNamespace?: PlugNamespaceDef;
};

export type SlashCommandDef = {
  name: string;
  description?: string;
  priority?: number;
  // Parent AST nodes in which this slash command is available, defaults to everywhere
  onlyContexts?: string[];
  // Parent AST nodes in which this slash command is not available
  exceptContexts?: string[];
};
export type SlashCommandHookT = {
  slashCommand?: SlashCommandDef;
};

export type SyscallHookT = {
  syscall?: string;
};

export type DocumentEditorT = {
  editor?: string | string[];
};

/** Silverbullet hooks give plugs access to silverbullet core systems.
 *
 * Hooks are associated with typescript functions through a manifest file.
 * On various triggers (user enters a slash command, an HTTP endpoint is hit, user clicks, etc) the typescript function is called.
 *
 * related: plugos/ui_types.ts#FunctionDef
 */
export type SilverBulletHooks = CommandHookT &
  SlashCommandHookT &
  MQHookT &
  EventHookT &
  CodeWidgetT &
  PlugNamespaceHookT &
  DocumentEditorT &
  SyscallHookT;

/** A plug manifest configures hooks, declares syntax extensions, and describes plug metadata.
 *
 * Typically the manifest file is in a plug's root directory, named `${plugName}.plug.yaml`.
 */
export type Manifest = PlugosManifest<SilverBulletHooks>;
