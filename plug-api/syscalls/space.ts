import { syscall } from "../syscall.ts";
import type { AttachmentMeta, FileMeta, PageMeta } from "../types.ts";

/**
 * Exposes the space with its pages, attachments and plugs.
 * @module
 */

/**
 * Lists all pages (files ending in .md) in the space.
 * @param unfiltered
 * @returns a list of all pages in the space represented as PageMeta objects
 */
export function listPages(): Promise<PageMeta[]> {
  return syscall("space.listPages");
}

/**
 * Get metadata for a page in the space.
 * @param name the name of the page to get metadata for
 * @returns the metadata for the page
 */
export function getPageMeta(name: string): Promise<PageMeta> {
  return syscall("space.getPageMeta", name);
}

/**
 * Read a page from the space as text.
 * @param name the name of the page to read
 * @returns the text of the page
 */
export function readPage(
  name: string,
): Promise<string> {
  return syscall("space.readPage", name);
}

/**
 * Write a page to the space.
 * @param name the name of the page to write
 * @param text the text of the page to write
 * @returns the metadata for the written page
 */
export function writePage(name: string, text: string): Promise<PageMeta> {
  return syscall("space.writePage", name, text);
}

/**
 * Delete a page from the space.
 * @param name the name of the page to delete
 */
export function deletePage(name: string): Promise<void> {
  return syscall("space.deletePage", name);
}

/**
 * List all plugs in the space.
 * @returns a list of all plugs in the space represented as FileMeta objects
 */
export function listPlugs(): Promise<FileMeta[]> {
  return syscall("space.listPlugs");
}

/**
 * Lists all attachments in the space (all files not ending in .md).
 * @returns a list of all attachments in the space represented as AttachmentMeta objects
 */
export function listAttachments(): Promise<AttachmentMeta[]> {
  return syscall("space.listAttachments");
}

/**
 * Get metadata for an attachment in the space.
 * @param name the path of the attachment to get metadata for
 * @returns the metadata for the attachment
 */
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

// Lower level-file operations

/**
 * List all files in the space (pages, attachments and plugs).
 * @returns a list of all files in the space represented as FileMeta objects
 */
export function listFiles(): Promise<FileMeta[]> {
  return syscall("space.listFiles");
}

/**
 * Read a file from the space as a Uint8Array.
 * @param name the name of the file to read
 * @returns the data of the file
 */
export function readFile(name: string): Promise<Uint8Array> {
  return syscall("space.readFile", name);
}

/**
 * Get metadata for a file in the space.
 * @param name the name of the file to get metadata for
 * @returns the metadata for the file
 */
export function getFileMeta(name: string): Promise<FileMeta> {
  return syscall("space.getFileMeta", name);
}

/**
 * Write a file to the space.
 * @param name the name of the file to write
 * @param data the data of the file to write
 * @returns the metadata for the written file
 */
export function writeFile(
  name: string,
  data: Uint8Array,
): Promise<FileMeta> {
  return syscall("space.writeFile", name, data);
}

/**
 * Delete a file from the space.
 * @param name the name of the file to delete
 */
export function deleteFile(name: string): Promise<void> {
  return syscall("space.deleteFile", name);
}
