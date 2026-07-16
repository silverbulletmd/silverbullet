export type FileMeta = {
  name: string;
  created: number;
  lastModified: number;
  contentType: string;
  size: number;
  perm: "ro" | "rw";
};
/**
 * Decorates a page when it matches certain criteria
 */
export type PageDecoration = {
  prefix?: string;
  cssClasses?: string[];
  hide?: boolean;
  renderWidgets?: boolean; // Defaults to true
};
export type PageMeta = ObjectValue<
  {
    name: string;
    created: string; // indexing it as a string
    lastModified: string; // indexing it as a string
    perm: "ro" | "rw";
    lastOpened?: number;
    pageDecoration?: PageDecoration;
  } & Record<string, any>
>;
export type DocumentMeta = ObjectValue<
  {
    name: string;
    contentType: string;
    created: string;
    lastModified: string;
    size: number;
    perm: "ro" | "rw";
    extension: string;
  } & Record<string, any>
>;
export type SyscallMeta = LuaFunctionDocumentation & {
  name: string;
  requiredPermissions: string[];
  argCount: number;
};

export type LuaFunctionParameterDocumentation = {
  name: string;
  type?: string;
  description?: string;
  optional?: boolean;
};

export type LuaFunctionReturnDocumentation = {
  type?: string;
  description?: string;
};

export type LuaFunctionExampleDocumentation = {
  code: string;
  description?: string;
  language?: string;
};

/** Structured documentation shared by Lua functions, built-ins and syscalls. */
export type LuaFunctionDocumentation = {
  description?: string;
  parameters?: LuaFunctionParameterDocumentation[];
  returns?: LuaFunctionReturnDocumentation[];
  /** Full signatures, used for overloaded or otherwise non-standard functions. */
  signatures?: string[];
  examples?: LuaFunctionExampleDocumentation[];
  deprecated?: string | boolean;
  /** Page or page anchor containing the full documentation. */
  see?: string;
};

export type LuaFunctionInfo = LuaFunctionDocumentation & {
  name?: string;
  kind: "lua" | "builtin" | "syscall";
  source?: Record<string, unknown>;
};
/**
 * An ObjectValue that can be indexed by the `index` plug, needs to have a minimum of
 * of two fields:
 * - ref: a unique reference (id) for the object, ideally a page reference
 * - tags: a list of tags that the object belongs to
 */
export type ObjectValue<T = any> = {
  ref: string;
  tag: string; // main tag
  range?: [number, number];
  tags?: string[];
  itags?: string[]; // implicit or inherited tags (inherited from the page for instance)
} & T;
