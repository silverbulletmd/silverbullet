import { syscall } from "./syscall.ts";
import { AttachmentMeta, PageMeta } from "../../common/types.ts";
import { FileMeta, ProxyFileSystem } from "../plugos-syscall/types.ts";

export class SpaceFileSystem implements ProxyFileSystem {
  // More space-specific methods

  listPages(unfiltered = false): Promise<PageMeta[]> {
    return syscall("space.listPages", unfiltered);
  }

  getPageMeta(name: string): Promise<PageMeta> {
    return syscall("space.getPageMeta", name);
  }

  readPage(
    name: string,
  ): Promise<string> {
    return syscall("space.readPage", name);
  }

  writePage(name: string, text: string): Promise<PageMeta> {
    return syscall("space.writePage", name, text);
  }

  deletePage(name: string): Promise<void> {
    return syscall("space.deletePage", name);
  }

  listPlugs(): Promise<string[]> {
    return syscall("space.listPlugs");
  }

  listAttachments(): Promise<PageMeta[]> {
    return syscall("space.listAttachments");
  }

  getAttachmentMeta(name: string): Promise<AttachmentMeta> {
    return syscall("space.getAttachmentMeta", name);
  }

  /**
   * Read an attachment from the space
   * @param name path of the attachment to read
   * @returns the attachment data encoded as a data URL
   */
  readAttachment(
    name: string,
  ): Promise<string> {
    return syscall("space.readAttachment", name);
  }

  /**
   * Writes an attachment to the space
   * @param name path of the attachment to write
   * @param encoding encoding of the data ("utf8" or "dataurl)
   * @param data data itself
   * @returns
   */
  writeAttachment(
    name: string,
    encoding: "utf8" | "dataurl",
    data: string,
  ): Promise<AttachmentMeta> {
    return syscall("space.writeAttachment", name, encoding, data);
  }

  /**
   * Deletes an attachment from the space
   * @param name path of the attachment to delete
   */
  deleteAttachment(name: string): Promise<void> {
    return syscall("space.deleteAttachment", name);
  }

  // Filesystem implementation
  readFile(path: string, encoding: "dataurl" | "utf8"): Promise<string> {
    return syscall("space.readFile", path, encoding);
  }
  getFileMeta(path: string): Promise<FileMeta> {
    return syscall("space.getFileMeta", path);
  }
  writeFile(
    path: string,
    text: string,
    encoding: "dataurl" | "utf8",
  ): Promise<FileMeta> {
    return syscall("space.writeFile", path, text, encoding);
  }
  deleteFile(path: string): Promise<void> {
    return syscall("space.deleteFile", path);
  }
  listFiles(path: string): Promise<FileMeta[]> {
    return syscall("space.listFiles", path);
  }
}

export default new SpaceFileSystem();
