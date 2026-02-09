import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";

export type FilterOption = {
  name: string;
  description?: string;
  orderId?: number;
  hint?: string;
  hintInactive?: boolean;
  classes?: string;
  prefix?: string;
} & Record<string, any>;

export type Notification = {
  id: number;
  message: string;
  type: "info" | "error";
  date: Date;
};

export type PanelMode = number;

export type CodeWidgetContent = {
  html?: string;
  script?: string;
  width?: number;
  height?: number;
  url?: string;
};

// Document editors stuff
export type DocumentEditorCallback = () => Promise<DocumentEditorContent>;
export type DocumentEditorContent = {
  html: string;
};

export type LintDiagnostic = {
  from: number;
  to: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
};

export type UploadFile = {
  name: string;
  contentType: string;
  content: Uint8Array;
};

export type AppEvent =
  | "page:click"
  | "slash:complete"
  | "editor:complete"
  | "editor:lint"
  | "editor:init"
  | "editor:pageLoaded" // args: pageName, previousPage, isSynced
  | "editor:pageReloaded"
  | "editor:pageSaving"
  | "editor:pageSaved"
  | "editor:pageCreating"
  | "editor:pageModified"
  | "editor:documentSaving"
  | "editor:documentSaved"
  | "editor:modeswitch"
  | "editor:fold"
  | "editor:unfold"
  | "plugs:loaded"
  | "cron:secondPassed"
  | "hooks:renderTopWidgets"
  | "hooks:renderBottomWidgets";

export type ClickEvent = {
  page: string;
  pos: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

export type EnrichedClickEvent = ClickEvent & {
  parentNodes: string[];
};

export type LintEvent = {
  name: string;
  pageMeta: PageMeta;
  tree: ParseTree;
  text: string;
};

export type CompleteEvent = {
  pageName: string;
  linePrefix: string;
  pos: number;
  parentNodes: string[];
};

export type SlashCompletionOption = {
  label: string;
  detail?: string;
  invoke: string;
  order?: number;
} & Record<string, any>;

export type SlashCompletions = {
  // Ignore this one, only for compatibility with regular completions
  from?: number;
  // The actual completions
  options: SlashCompletionOption[];
};

// Code widget stuff
export type CodeWidgetCallback = (
  bodyText: string,
  pageName: string,
) => Promise<CodeWidgetContent | null>;
