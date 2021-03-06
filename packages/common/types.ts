export type PageMeta = {
  name: string;
  lastModified: number;
  lastOpened?: number;
  perm: "ro" | "rw";
};

// Used by FilterBox
export type FilterOption = {
  name: string;
  orderId?: number;
  hint?: string;
};
