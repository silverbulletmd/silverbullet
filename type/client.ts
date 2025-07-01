import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";

export type FilterOption = {
  name: string;
  description?: string;
  orderId?: number;
  hint?: string;
  hintInactive?: boolean;
  classes?: string;
  category?: string;
} & Record<string, any>;

export type Notification = {
  id: number;
  message: string;
  type: "info" | "error";
  date: Date;
};

export type PanelMode = number;

export type CodeWidgetContent = {
  html: string;
  script?: string;
  buttons?: CodeWidgetButton[];
};

export type CodeWidgetButton = {
  widgetTarget?: boolean;
  description: string;
  svg: string;
  invokeFunction: string[];
};

// Document editors stuff
export type DocumentEditorCallback = () => Promise<DocumentEditorContent>;
export type DocumentEditorContent = {
  html: string;
  script?: string;
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
  | "editor:complete"
  | "minieditor:complete"
  | "slash:complete"
  | "editor:lint"
  | "page:load"
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
  tree: ParseTree;
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

export type WidgetContent = {
  html?: string;
  script?: string;
  markdown?: string;
  url?: string;
  height?: number;
  width?: number;
};

// Code widget stuff
export type CodeWidgetCallback = (
  bodyText: string,
  pageName: string,
) => Promise<CodeWidgetContent | null>;
