import { syscall } from "../syscall.ts";
import { AttachmentMeta, FileMeta, PageMeta } from "../types.ts";

export function listPages(unfiltered = false): Promise<PageMeta[]> {
  return syscall("space.listPages", unfiltered);
}

export function getPageMeta(name: string): Promise<PageMeta> {
  return syscall("space.getPageMeta", name);
}

export function readPage(
  name: string,
): Promise<string> {
  return syscall("space.readPage", name);
}

export function writePage(name: string, text: string): Promise<PageMeta> {
  return syscall("space.writePage", name, text);
}

export function deletePage(name: string): Promise<void> {
  return syscall("space.deletePage", name);
}

export function listPlugs(): Promise<FileMeta[]> {
  return syscall("space.listPlugs");
}

export function listAttachments(): Promise<AttachmentMeta[]> {
  return syscall("space.listAttachments");
}

export function getAttachmentMeta(name: string): Promise<AttachmentMeta> {
  return syscall("space.getAttachmentMeta", name);
}

/**
 * Read an attachment from the space
 * @param name path of the attachment to read
 * @returns the attachment data encoded as a data URL
 */
export function readAttachment(
  name: string,
): Promise<Uint8Array> {
  return syscall("space.readAttachment", name);
}

/**
 * Writes an attachment to the space
 * @param name path of the attachment to write
 * @param data data itself
 * @returns
 */
export function writeAttachment(
  name: string,
  data: Uint8Array,
): Promise<AttachmentMeta> {
  return syscall("space.writeAttachment", name, data);
}

/**
 * Deletes an attachment from the space
 * @param name path of the attachment to delete
 */
export function deleteAttachment(name: string): Promise<void> {
  return syscall("space.deleteAttachment", name);
}

// FS
export function listFiles(): Promise<FileMeta[]> {
  return syscall("space.listFiles");
}

export function readFile(name: string): Promise<Uint8Array> {
  return syscall("space.readFile", name);
}

export function getFileMeta(name: string): Promise<FileMeta> {
  return syscall("space.getFileMeta", name);
}

export function writeFile(
  name: string,
  data: Uint8Array,
): Promise<FileMeta> {
  return syscall("space.writeFile", name, data);
}

export function deleteFile(name: string): Promise<void> {
  return syscall("space.deleteFile", name);
}
