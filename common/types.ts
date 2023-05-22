export const maximumAttachmentSize = 20 * 1024 * 1024; // 10 MB

export type FileMeta = {
  name: string;
  lastModified: number;
  contentType: string;
  size: number;
  perm: "ro" | "rw";
} & Record<string, any>;
