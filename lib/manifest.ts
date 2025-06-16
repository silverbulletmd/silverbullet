import type { Manifest as PlugosManifest } from "./plugos/types.ts";
import type { NamespaceOperation } from "./plugos/namespace.ts";

export type CodeWidgetT = {
  codeWidget?: string;
  renderMode?: "iframe";
};

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
  requireEditor?: "any" | "page" | "notpage" | string;
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
export type SilverBulletHooks =
  & CommandHookT
  & SlashCommandHookT
  & MQHookT
  & EventHookT
  & CodeWidgetT
  & PlugNamespaceHookT
  & DocumentEditorT
  & SyscallHookT;

/** A plug manifest configures hooks, declares syntax extensions, and describes plug metadata.
 *
 * Typically the manifest file is in a plug's root directory, named `${plugName}.plug.yaml`.
 */
export type Manifest = PlugosManifest<SilverBulletHooks>;
