// Used by FilterBox
export type FilterOption = {
  name: string;
  description?: string;
  orderId?: number;
  hint?: string;
  hintInactive?: boolean;
  classes?: string;
} & Record<string, any>;

export type Notification = {
  id: number;
  message: string;
  type: "info" | "error";
  date: Date;
};

export type PanelMode = number;

export type Shortcut = {
  // Command we're creating the shortcut for
  command: string;
  // (Re)bind to keyboard shortcut
  key?: string;
  mac?: string;
  // Bind to slash command
  slashCommand?: string;
  // Tweak priority in command palette
  priority?: number;
};

export type ActionButton = {
  icon: string;
  description?: string;
  command: string;
  args?: any[];
  mobile?: boolean;
};

export type EmojiConfig = {
  aliases: string[][];
};

export type SmartQuotesConfig = {
  enabled?: boolean;
  double?: { left?: string; right?: string };
  single?: { left?: string; right?: string };
};

type vimMode = "normal" | "insert" | "visual";

export type VimConfig = {
  unmap?: (string | { key: string; mode?: vimMode })[];
  map?: { map: string; to: string; mode?: vimMode }[];
  noremap?: { map: string; to: string; mode?: vimMode }[];
  commands?: { ex: string; command: string }[];
};

export type QueryCollationConfig = {
  enabled?: boolean;
  locale?: string;
  options?: object;
};
