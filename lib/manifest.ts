import { Manifest as PlugosManifest } from "./plugos/types.ts";
import { CommandDef } from "./command.ts";
import { NamespaceOperation } from "./plugos/namespace.ts";

export type CodeWidgetT = {
  codeWidget?: string;
  renderMode?: "markdown" | "iframe";
};

export type CommandHookT = {
  command?: CommandDef;
};

export type CronHookT = {
  cron?: string | string[];
};

type EndPointDef = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS" | "ANY";
  path: string;
};
export type EndpointHookT = {
  http?: EndPointDef | EndPointDef[];
};

export type EventHookT = {
  events?: string[];
};

type MQSubscription = {
  queue: string;
  batchSize?: number;
  autoAck?: boolean;
};
export type MQHookT = {
  mqSubscriptions?: MQSubscription[];
};

export type PanelWidgetT = {
  panelWidget?: "top" | "bottom";
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
  boost?: number;
};
export type SlashCommandHookT = {
  slashCommand?: SlashCommandDef;
};

/** Silverbullet hooks give plugs access to silverbullet core systems.
 *
 * Hooks are associated with typescript functions through a manifest file.
 * On various triggers (user enters a slash command, an HTTP endpoint is hit, user clicks, etc) the typescript function is called.
 *
 * related: plugos/type.ts#FunctionDef
 */
export type SilverBulletHooks =
  & CommandHookT
  & SlashCommandHookT
  & CronHookT
  & MQHookT
  & EventHookT
  & CodeWidgetT
  & PanelWidgetT
  & EndpointHookT
  & PlugNamespaceHookT;

/** A plug manifest configures hooks, declares syntax extensions, and describes plug metadata.
 *
 * Typically the manifest file is in a plug's root directory, named `${plugName}.plug.yaml`.
 */
export type Manifest = PlugosManifest<SilverBulletHooks>;
