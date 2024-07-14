// Used by FilterBox
export type FilterOption = {
  name: string;
  description?: string;
  orderId?: number;
  hint?: string;
} & Record<string, any>;

export type Notification = {
  id: number;
  message: string;
  type: "info" | "error";
  date: Date;
};

export type PanelMode = number;

export type Shortcut = {
  key?: string;
  mac?: string;
  priority?: number;
  command: string;
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
