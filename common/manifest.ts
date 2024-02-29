import * as plugos from "../lib/plugos/types.ts";
import { CronHookT } from "../lib/plugos/hooks/cron.ts";
import { EventHookT } from "./hooks/event.ts";
import { CommandHookT } from "$lib/command.ts";
import { SlashCommandHookT } from "../web/hooks/slash_command.ts";
import { PlugNamespaceHookT } from "./hooks/plug_namespace.ts";
import { CodeWidgetT } from "../web/hooks/code_widget.ts";
import { MQHookT } from "../lib/plugos/hooks/mq.ts";
import { EndpointHookT } from "../server/hooks/endpoint.ts";
import { PanelWidgetT } from "../web/hooks/panel_widget.ts";

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
export type Manifest = plugos.Manifest<SilverBulletHooks>;
