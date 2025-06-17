export type FileMeta = {
  name: string;
  created: number;
  lastModified: number;
  contentType: string;
  size: number;
  perm: "ro" | "rw";
  noSync?: boolean;
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
export type SyscallMeta = {
  name: string;
  requiredPermissions: string[];
  argCount: number;
};
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
