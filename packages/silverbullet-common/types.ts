export type PageMeta = {
  name: string;
  lastModified: number;
  lastOpened?: number;
  created?: boolean;
};

// Used by FilterBox
export type FilterOption = {
  name: string;
  orderId?: number;
  hint?: string;
};
