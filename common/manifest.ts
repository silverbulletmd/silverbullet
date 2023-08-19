import * as plugos from "../plugos/types.ts";
import { CronHookT } from "../plugos/hooks/cron.ts";
import { EventHookT } from "../plugos/hooks/event.ts";
import { CommandHookT } from "../web/hooks/command.ts";
import { SlashCommandHookT } from "../web/hooks/slash_command.ts";
import { PlugNamespaceHookT } from "./hooks/plug_namespace.ts";
import { CodeWidgetT } from "../web/hooks/code_widget.ts";
import { MQHookT } from "../plugos/hooks/mq.ts";
import { EndpointHookT } from "../plugos/hooks/endpoint.ts";

/** @typedef {import("../plugos/types.ts")} plugos */

/** Silverbullet hooks give plugs access to silverbullet core systems. */
export type SilverBulletHooks =
  & CommandHookT
  & SlashCommandHookT
  & CronHookT
  & MQHookT
  & EventHookT
  & CodeWidgetT
  & EndpointHookT
  & PlugNamespaceHookT;

/** Syntax extension allow plugs to declaratively add new *inline* parse tree nodes to the markdown parser. */
export type SyntaxExtensions = {
  /** Key-value pair of node **name** (see: plug-api/lib/tree.ts#ParseTree.type), to parsing and highlighting instructions.
   */
  syntax?: { [key: string]: NodeDef };
};

/** Parsing and highlighting instructions for SyntaxExtension */
export type NodeDef = {
  /** Characters to begin matching on. */
  firstCharacters: string[];

  /** A regular expression that matches the *entire* syntax, including the first character. */
  regex: string;

  /** CSS styles to apply to the matched text.
   * 
   * Key-value pair of CSS key to value:
   * 
   * **Example**: `backgroundColor: "rgba(22,22,22,0.07)"`
   */
  styles: { [key: string]: string };

  /** CSS class name to apply to the matched text */
  className?: string;
};

/** A plug manifest configures {@link SilverBulletHooks hooks}, declares {@link SyntaxExtensions syntax} extensions, and describes plug.
 *
 * Typically the manifest file is in a plug's root directory, named `${plugName}.plug.yaml`.
 */
export type Manifest = plugos.Manifest<SilverBulletHooks> & SyntaxExtensions;
