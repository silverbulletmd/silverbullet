import * as plugos from "../plugos/types.ts";
import { CronHookT } from "../plugos/hooks/cron.ts";
import { EventHookT } from "../plugos/hooks/event.ts";
import { CommandHookT } from "../web/hooks/command.ts";
import { SlashCommandHookT } from "../web/hooks/slash_command.ts";
import { PlugNamespaceHookT } from "./hooks/plug_namespace.ts";
import { CodeWidgetT } from "../web/hooks/code_widget.ts";
import { MQHookT } from "../plugos/hooks/mq.ts";

export type SilverBulletHooks =
  & CommandHookT
  & SlashCommandHookT
  & CronHookT
  & MQHookT
  & EventHookT
  & CodeWidgetT
  & PlugNamespaceHookT;

export type SyntaxExtensions = {
  syntax?: { [key: string]: NodeDef };
};

export type NodeDef = {
  firstCharacters: string[];
  regex: string;
  styles: { [key: string]: string };
  className?: string;
};

export type Manifest = plugos.Manifest<SilverBulletHooks> & SyntaxExtensions;
