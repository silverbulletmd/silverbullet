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

export type NotificationType = "info" | "error" | "warning";

export const notificationDismissTimeouts: Record<NotificationType, number> = {
  info: 4000,
  error: 5000,
  warning: 8000,
};

export type NotificationAction = {
  name: string;
  run: () => void;
};

export type Notification = {
  id: number;
  message: string;
  type: NotificationType;
  date: Date;
  actions?: NotificationAction[];
  persistent?: boolean;
};

// A plain number is a flex-grow ratio (or, for the modal slot, a pixel
// inset); a string is a raw CSS `flex` shorthand, e.g. "0 0 260px" for a
// fixed-width sidebar.
export type PanelMode = number | string;

export type EditorGutterMarker = {
  /** One-based line number in the current editor document. */
  line: number;
  /** Text rendered in the gutter for this line. */
  text: string;
  /** Optional tooltip shown when hovering the marker. */
  title?: string;
  /** Optional CSS class names for this marker. */
  className?: string;
  /** Full Git commit hash opened when this marker is clicked. */
  rev?: string;
  /** One-based line number in the revision identified by `rev`. */
  revisionLine?: number;
};

export type EditorGutter = {
  /** The page this data belongs to; omitted means the current page. */
  page?: string;
  /** A named gutter's line markers. Replacing the same id replaces all rows. */
  markers: readonly EditorGutterMarker[];
  /** Fixed width in editor-font character units. */
  width?: number;
  /** Optional CSS class names applied to every marker in this gutter. */
  className?: string;
};

export type CodeWidgetContent = {
  html?: string;
  script?: string;
  width?: number;
  height?: number;
  url?: string;
};

export type DocumentEditorCallback = () => Promise<DocumentEditorContent>;
export type DocumentEditorContent = {
  html: string;
};

export type LintDiagnostic = {
  from: number;
  to: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  /**
   * Optional HTML rendered into the hover tooltip for this diagnostic.
   * When present, takes precedence over `message` for tooltip display.
   * `message` is still used as a plain-text fallback (e.g. in the lint
   * panel) and as the diagnostic's accessible label.
   */
  messageHtml?: string;
  /**
   * Optional CSS class added to the inline range mark for this diagnostic,
   * in addition to CodeMirror's default `.cm-lintRange-<severity>` class.
   */
  markClass?: string;
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

export type CodeWidgetCallback = (
  bodyText: string,
  pageName: string,
) => Promise<CodeWidgetContent | null>;
