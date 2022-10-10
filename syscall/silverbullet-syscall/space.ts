import { syscall } from "./syscall.ts";
import { AttachmentMeta, PageMeta } from "../../common/types.ts";

export function listPages(unfiltered = false): Promise<PageMeta[]> {
  return syscall("space.listPages", unfiltered);
}

export function getPageMeta(name: string): Promise<PageMeta> {
  return syscall("space.getPageMeta", name);
}

export function readPage(
  name: string,
): Promise<{ text: string; meta: PageMeta }> {
  return syscall("space.readPage", name);
}

export function writePage(name: string, text: string): Promise<PageMeta> {
  return syscall("space.writePage", name, text);
}

export function deletePage(name: string): Promise<void> {
  return syscall("space.deletePage", name);
}

export function listPlugs(): Promise<string[]> {
  return syscall("space.listPlugs");
}

export function listAttachments(): Promise<PageMeta[]> {
  return syscall("space.listAttachments");
}

export function getAttachmentMeta(name: string): Promise<AttachmentMeta> {
  return syscall("space.getAttachmentMeta", name);
}

export function readAttachment(
  name: string,
): Promise<{ data: string; meta: AttachmentMeta }> {
  return syscall("space.readAttachment", name);
}

export function writeAttachment(
  name: string,
  encoding: "string" | "dataurl",
  data: string,
): Promise<AttachmentMeta> {
  return syscall("space.writeAttachment", name, encoding, data);
}

export function deleteAttachment(name: string): Promise<void> {
  return syscall("space.deleteAttachment", name);
}
