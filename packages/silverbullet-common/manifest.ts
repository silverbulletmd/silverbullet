import * as plugos from "../plugos/types";
import { EndpointHookT } from "../plugos/hooks/endpoint";
import { CronHookT } from "../plugos/hooks/node_cron";
import { EventHookT } from "../plugos/hooks/event";
import { CommandHookT } from "@silverbulletmd/web/hooks/command";
import { SlashCommandHookT } from "@silverbulletmd/web/hooks/slash_command";

export type SilverBulletHooks = CommandHookT &
  SlashCommandHookT &
  EndpointHookT &
  CronHookT &
  EventHookT;

export type SyntaxExtensions = {
  syntax?: { [key: string]: NodeDef };
};

export type NodeDef = {
  firstCharacters: string[];
  regex: string;
  styles: { [key: string]: string };
};

export type Manifest = plugos.Manifest<SilverBulletHooks> & SyntaxExtensions;
