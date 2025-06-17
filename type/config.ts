export type EmojiConfig = {
  aliases: string[][];
};
export type QueryCollationConfig = {
  enabled?: boolean;
  locale?: string;
  options?: object;
};

type vimMode = "normal" | "insert" | "visual";

export type VimConfig = {
  unmap?: (string | { key: string; mode?: vimMode })[];
  map?: { map: string; to: string; mode?: vimMode }[];
  noremap?: { map: string; to: string; mode?: vimMode }[];
  commands?: { ex: string; command: string }[];
};
export type SmartQuotesConfig = {
  enabled?: boolean;
  double?: { left?: string; right?: string };
  single?: { left?: string; right?: string };
};
