import * as plugbox from "../plugbox/types";
import { EndpointHook } from "../plugbox/types";

export type CommandDef = {
  // Function name to invoke
  invoke: string;

  // Bind to keyboard shortcut
  key?: string;
  mac?: string;

  // If to show in slash invoked menu and if so, with what label
  // should match slashCommandRegexp
  slashCommand?: string;
};

export type SilverBulletHooks = {
  commands?: {
    [key: string]: CommandDef;
  };
} & plugbox.EndpointHook;

export type Manifest = plugbox.Manifest<SilverBulletHooks>;
