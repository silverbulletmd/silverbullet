import * as plugos from "../plugos/types.ts";
import { CronHookT } from "../plugos/hooks/cron.ts";
import { EventHookT } from "../plugos/hooks/event.ts";
import { CommandHookT } from "../web/hooks/command.ts";
import { SlashCommandHookT } from "../web/hooks/slash_command.ts";
import { PlugNamespaceHookT } from "./hooks/plug_namespace.ts";
import { CodeWidgetT } from "../web/hooks/code_widget.ts";
import { MQHookT } from "../plugos/hooks/mq.ts";
import { EndpointHookT } from "../plugos/hooks/endpoint.ts";
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

/** Syntax extension allow plugs to declaratively add new *inline* parse tree nodes to the markdown parser. */
export type SyntaxExtensions = {
  /** A map of node **name** (also called "type"), to parsing and highlighting instructions. Each entry defines a new node. By convention node names (types) are UpperCamelCase (PascalCase).
   *
   * see: plug-api/lib/tree.ts#ParseTree
   */
  syntax?: { [key: string]: NodeDef };
};

/** Parsing and highlighting instructions for SyntaxExtension */
export type NodeDef = {
  /** An array of possible first characters to begin matching on.
   *
   * **Example**: If this node has the regex '[abc][123]', NodeDef.firstCharacters should be ["a", "b", "c"].
   */
  firstCharacters: string[];

  /** A regular expression that matches the *entire* syntax, including the first character. */
  regex: string;

  /** CSS styles to apply to the matched text.
   *
   * Key-value pair of CSS key to value:
   *
   * **Example**: `backgroundColor: "rgba(22,22,22,0.07)"`
   */
  styles?: { [key: string]: string };

  /** CSS class name to apply to the matched text */
  className?: string;
};

/** A plug manifest configures hooks, declares syntax extensions, and describes plug metadata.
 *
 * Typically the manifest file is in a plug's root directory, named `${plugName}.plug.yaml`.
 */
export type Manifest = plugos.Manifest<SilverBulletHooks> & SyntaxExtensions;
