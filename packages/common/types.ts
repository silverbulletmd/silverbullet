export const reservedPageNames = ["page", "attachment", "plug"];
export const maximumAttachmentSize = 100 * 1024 * 1024; // 100 MB

export type PageMeta = {
  name: string;
  lastModified: number;
  lastOpened?: number;
  perm: "ro" | "rw";
};

export type AttachmentMeta = {
  name: string;
  contentType: string;
  lastModified: number;
  size: number;
  perm: "ro" | "rw";
};

// Used by FilterBox
export type FilterOption = {
  name: string;
  orderId?: number;
  hint?: string;
};
