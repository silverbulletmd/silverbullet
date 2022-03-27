import * as plugbox from "../plugbox/types";
import { EndpointHook } from "../plugbox/feature/endpoint";
import { CronHook } from "../plugbox/feature/node_cron";
import { EventHook } from "../plugbox/feature/event";

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

export type Manifest = plugbox.Manifest<SilverBulletHooks>;
