import * as plugos from "@plugos/plugos/types";
import { EndpointHookT } from "@plugos/plugos/hooks/endpoint";
import { CronHookT } from "@plugos/plugos/hooks/node_cron";
import { EventHookT } from "@plugos/plugos/hooks/event";
import { CommandHookT } from "@silverbulletmd/web/hooks/command";
import { SlashCommandHookT } from "@silverbulletmd/web/hooks/slash_command";
import { PageNamespaceHookT } from "../server/hooks/page_namespace";

export type SilverBulletHooks = CommandHookT &
  SlashCommandHookT &
  EndpointHookT &
  CronHookT &
  EventHookT &
  PageNamespaceHookT;

export type SyntaxExtensions = {
  syntax?: { [key: string]: NodeDef };
};

export type NodeDef = {
  firstCharacters: string[];
  regex: string;
  styles: { [key: string]: string };
};

export type Manifest = plugos.Manifest<SilverBulletHooks> & SyntaxExtensions;
