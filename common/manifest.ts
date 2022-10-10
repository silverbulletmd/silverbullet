import * as plugos from "../plugos/types.ts";
import { EndpointHookT } from "../plugos/hooks/endpoint.ts";
import { CronHookT } from "../plugos/hooks/cron.deno.ts";
import { EventHookT } from "../plugos/hooks/event.ts";
import { CommandHookT } from "../web/hooks/command.ts";
import { SlashCommandHookT } from "../web/hooks/slash_command.ts";
import { PageNamespaceHookT } from "../server/hooks/page_namespace.ts";

export type SilverBulletHooks =
  & CommandHookT
  & SlashCommandHookT
  & EndpointHookT
  & CronHookT
  & EventHookT
  & PageNamespaceHookT;

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
