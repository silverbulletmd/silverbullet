import * as plugos from "../plugos/types";
import { EndpointHook } from "../plugos/feature/endpoint";
import { CronHook } from "../plugos/feature/node_cron";
import { EventHook } from "../plugos/feature/event";

export type CommandDef = {
  name: string;

  // Bind to keyboard shortcut
  key?: string;
  mac?: string;

  // If to show in slash invoked menu and if so, with what label
  // should match slashCommandRegexp
  slashCommand?: string;
};

export type SilverBulletHooks = {
  command?: CommandDef | CommandDef[];
} & EndpointHook &
  CronHook &
  EventHook;

export type Manifest = plugos.Manifest<SilverBulletHooks>;
