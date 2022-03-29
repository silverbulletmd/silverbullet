import * as plugos from "../plugos/types";
import { EndpointHookT } from "../plugos/hooks/endpoint";
import { CronHookT } from "../plugos/hooks/node_cron";
import { EventHookT } from "../plugos/hooks/event";
import { CommandHookT } from "../webapp/hooks/command";
import { SlashCommandHookT } from "../webapp/hooks/slash_command";
import { CompleterHookT } from "../webapp/hooks/completer";

export type SilverBulletHooks = CommandHookT &
  CompleterHookT &
  SlashCommandHookT &
  EndpointHookT &
  CronHookT &
  EventHookT;

export type Manifest = plugos.Manifest<SilverBulletHooks>;
