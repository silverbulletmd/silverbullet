export type FileMeta = {
  name: string;
  created: number;
  lastModified: number;
  contentType: string;
  size: number;
  perm: "ro" | "rw";
  noSync?: boolean;
};

export type PageMeta = ObjectValue<
  {
    name: string;
    created: string; // indexing it as a string
    lastModified: string; // indexing it as a string
    lastOpened?: number;
    perm: "ro" | "rw";
  } & Record<string, any>
>;

export type AttachmentMeta = {
  name: string;
  contentType: string;
  created: number;
  lastModified: number;
  size: number;
  perm: "ro" | "rw";
};

// Message Queue related types
export type MQMessage = {
  id: string;
  queue: string;
  body: any;
  retries?: number;
};

export type MQStats = {
  queued: number;
  processing: number;
  dlq: number;
};

export type MQSubscribeOptions = {
  batchSize?: number;
  pollInterval?: number;
};

// Key-Value Store related types
export type KvKey = string[];

export type KV<T = any> = {
  key: KvKey;
  value: T;
};

export type OrderBy = {
  expr: QueryExpression;
  desc: boolean;
};

export type Select = {
  name: string;
  expr?: QueryExpression;
};

export type Query = {
  querySource?: string;
  filter?: QueryExpression;
  orderBy?: OrderBy[];
  select?: Select[];
  limit?: QueryExpression;
  render?: string;
  renderAll?: boolean;
  distinct?: boolean;
};

export type KvQuery = Omit<Query, "querySource"> & {
  prefix?: KvKey;
};

export type QueryExpression =
  | ["and", QueryExpression, QueryExpression]
  | ["or", QueryExpression, QueryExpression]
  | ["=", QueryExpression, QueryExpression]
  | ["!=", QueryExpression, QueryExpression]
  | ["=~", QueryExpression, QueryExpression]
  | ["!=~", QueryExpression, QueryExpression]
  | ["<", QueryExpression, QueryExpression]
  | ["<=", QueryExpression, QueryExpression]
  | [">", QueryExpression, QueryExpression]
  | [">=", QueryExpression, QueryExpression]
  | ["in", QueryExpression, QueryExpression]
  | ["attr", QueryExpression, string]
  | ["attr", string]
  | ["number", number]
  | ["string", string]
  | ["boolean", boolean]
  | ["null"]
  | ["not", QueryExpression]
  | ["array", QueryExpression[]]
  | ["object", Record<string, any>]
  | ["regexp", string, string] // regex, modifier
  | ["+", QueryExpression, QueryExpression]
  | ["-", QueryExpression, QueryExpression]
  | ["*", QueryExpression, QueryExpression]
  | ["%", QueryExpression, QueryExpression]
  | ["/", QueryExpression, QueryExpression]
  | ["call", string, QueryExpression[]];

export type FunctionMap = Record<string, (...args: any[]) => any>;

/**
 * An ObjectValue that can be indexed by the `index` plug, needs to have a minimum of
 * of two fields:
 * - ref: a unique reference (id) for the object, ideally a page reference
 * - tags: a list of tags that the object belongs to
 */
export type ObjectValue<T> = {
  ref: string;
  tag: string; // main tag
  tags?: string[];
  itags?: string[]; // implicit or inherited tags (inherited from the page for instance)
} & T;

export type ObjectQuery = Omit<Query, "prefix">;

// Code widget stuff
export type CodeWidgetCallback = (
  bodyText: string,
  pageName: string,
) => Promise<CodeWidgetContent | null>;

export type CodeWidgetContent = {
  html?: string;
  markdown?: string;
  script?: string;
  buttons?: CodeWidgetButton[];
};

export type CodeWidgetButton = {
  widgetTarget?: boolean;
  description: string;
  svg: string;
  invokeFunction: string;
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
