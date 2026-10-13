export type SearchMode = "words" | "natural" | "phrase" | "regex";

/** Which pages a search covers, like the page picker's Pages/Meta/All segments. */
export type SearchScope = "pages" | "meta" | "all";

export type SearchStatus = {
  backend: string | null;
  model: string | null;
  capabilities: { modes: SearchMode[]; related: boolean };
  ready: boolean;
  progress: { done: number; total: number } | null;
  reason: string | null;
};

export type SearchMatch = {
  page: string;
  pos: number;
  line: number;
  heading?: string;
  excerpt: string;
  highlights: [number, number][];
};

export type SearchResult = {
  items: SearchMatch[];
  total: number;
  partial: boolean;
  notice: string | null;
};

export type QueryOptions = {
  mode?: SearchMode;
  scope?: SearchScope;
  include?: string[];
  exclude?: string[];
  limit?: number;
};

export type RelatedResult = SearchResult & { waitingForIndex?: boolean };

export type RgResult = {
  exitCode: number;
  stdoutBase64: string;
  stderrBase64: string;
  truncated: boolean;
  timedOut: boolean;
};
