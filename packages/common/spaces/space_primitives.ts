import { Plug } from "@plugos/plugos/plug";
import { AttachmentMeta, PageMeta } from "../types";

export type AttachmentEncoding = "arraybuffer" | "dataurl";
export type AttachmentData = ArrayBuffer | string;
export interface SpacePrimitives {
  // Pages
  fetchPageList(): Promise<{ pages: Set<PageMeta>; nowTimestamp: number }>;
  readPage(name: string): Promise<{ text: string; meta: PageMeta }>;
  getPageMeta(name: string): Promise<PageMeta>;
  writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<PageMeta>;
  deletePage(name: string): Promise<void>;

  // Attachments
  fetchAttachmentList(): Promise<{
    attachments: Set<AttachmentMeta>;
    nowTimestamp: number;
  }>;
  readAttachment(
    name: string,
    encoding: AttachmentEncoding
  ): Promise<{ data: AttachmentData; meta: AttachmentMeta }>;
  getAttachmentMeta(name: string): Promise<AttachmentMeta>;
  writeAttachment(
    name: string,
    data: AttachmentData,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<AttachmentMeta>;
  deleteAttachment(name: string): Promise<void>;

  // Plugs
  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any>;
  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any>;
}
