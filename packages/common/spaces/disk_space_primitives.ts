import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  utimes,
  writeFile,
} from "fs/promises";
import * as path from "path";
import { AttachmentMeta, PageMeta } from "../types";
import { SpacePrimitives } from "./space_primitives";
import { Plug } from "@plugos/plugos/plug";
import { realpathSync } from "fs";
import mime from "mime-types";

export class DiskSpacePrimitives implements SpacePrimitives {
  rootPath: string;
  plugPrefix: string;

  constructor(rootPath: string, plugPrefix: string = "_plug/") {
    this.rootPath = realpathSync(rootPath);
    this.plugPrefix = plugPrefix;
  }

  safePath(p: string): string {
    let realPath = path.resolve(p);
    if (!realPath.startsWith(this.rootPath)) {
      throw Error(`Path ${p} is not in the space`);
    }
    return realPath;
  }

  pageNameToPath(pageName: string) {
    if (pageName.startsWith(this.plugPrefix)) {
      return this.safePath(path.join(this.rootPath, pageName + ".plug.json"));
    }
    return this.safePath(path.join(this.rootPath, pageName + ".md"));
  }

  pathToPageName(fullPath: string): string {
    let extLength = fullPath.endsWith(".plug.json")
      ? ".plug.json".length
      : ".md".length;
    return fullPath.substring(
      this.rootPath.length + 1,
      fullPath.length - extLength
    );
  }

  // Pages
  async readPage(pageName: string): Promise<{ text: string; meta: PageMeta }> {
    const localPath = this.pageNameToPath(pageName);
    try {
      const s = await stat(localPath);
      return {
        text: await readFile(localPath, "utf8"),
        meta: {
          name: pageName,
          lastModified: s.mtime.getTime(),
          perm: "rw",
        },
      };
    } catch (e) {
      // console.error("Error while reading page", pageName, e);
      throw Error(`Could not read page ${pageName}`);
    }
  }

  async writePage(
    pageName: string,
    text: string,
    selfUpdate: boolean,
    lastModified?: number
  ): Promise<PageMeta> {
    let localPath = this.pageNameToPath(pageName);
    try {
      // Ensure parent folder exists
      await mkdir(path.dirname(localPath), { recursive: true });

      // Actually write the file
      await writeFile(localPath, text);

      if (lastModified) {
        let d = new Date(lastModified);
        console.log("Going to set the modified time", d);
        await utimes(localPath, d, d);
      }
      // Fetch new metadata
      const s = await stat(localPath);
      return {
        name: pageName,
        lastModified: s.mtime.getTime(),
        perm: "rw",
      };
    } catch (e) {
      console.error("Error while writing page", pageName, e);
      throw Error(`Could not write ${pageName}`);
    }
  }

  async getPageMeta(pageName: string): Promise<PageMeta> {
    let localPath = this.pageNameToPath(pageName);
    try {
      const s = await stat(localPath);
      return {
        name: pageName,
        lastModified: s.mtime.getTime(),
        perm: "rw",
      };
    } catch (e) {
      // console.error("Error while getting page meta", pageName, e);
      throw Error(`Could not get meta for ${pageName}`);
    }
  }

  async deletePage(pageName: string): Promise<void> {
    let localPath = this.pageNameToPath(pageName);
    await unlink(localPath);
  }

  async fetchPageList(): Promise<{
    pages: Set<PageMeta>;
    nowTimestamp: number;
  }> {
    let pages = new Set<PageMeta>();

    const walkPath = async (dir: string) => {
      let files = await readdir(dir);
      for (let file of files) {
        const fullPath = path.join(dir, file);
        let s = await stat(fullPath);
        if (s.isDirectory()) {
          await walkPath(fullPath);
        } else {
          if (file.endsWith(".md") || file.endsWith(".json")) {
            pages.add({
              name: this.pathToPageName(fullPath),
              lastModified: s.mtime.getTime(),
              perm: "rw",
            });
          }
        }
      }
    };
    await walkPath(this.rootPath);
    return {
      pages: pages,
      nowTimestamp: Date.now(),
    };
  }

  // Attachments
  attachmentNameToPath(name: string) {
    return this.safePath(path.join(this.rootPath, name));
  }

  pathToAttachmentName(fullPath: string): string {
    return fullPath.substring(this.rootPath.length + 1);
  }

  async fetchAttachmentList(): Promise<{
    attachments: Set<AttachmentMeta>;
    nowTimestamp: number;
  }> {
    let attachments = new Set<AttachmentMeta>();

    const walkPath = async (dir: string) => {
      let files = await readdir(dir);
      for (let file of files) {
        const fullPath = path.join(dir, file);
        let s = await stat(fullPath);
        if (s.isDirectory()) {
          if (!file.startsWith(".")) {
            await walkPath(fullPath);
          }
        } else {
          if (
            !file.startsWith(".") &&
            !file.endsWith(".md") &&
            !file.endsWith(".json")
          ) {
            attachments.add({
              name: this.pathToAttachmentName(fullPath),
              lastModified: s.mtime.getTime(),
              size: s.size,
              contentType: mime.lookup(file) || "application/octet-stream",
              perm: "rw",
            } as AttachmentMeta);
          }
        }
      }
    };
    await walkPath(this.rootPath);
    return {
      attachments,
      nowTimestamp: Date.now(),
    };
  }

  async readAttachment(
    name: string
  ): Promise<{ buffer: ArrayBuffer; meta: AttachmentMeta }> {
    const localPath = this.attachmentNameToPath(name);
    let fileBuffer = await readFile(localPath);

    try {
      const s = await stat(localPath);
      return {
        buffer: fileBuffer.buffer,
        meta: {
          name: name,
          lastModified: s.mtime.getTime(),
          size: s.size,
          contentType: mime.lookup(name) || "application/octet-stream",
          perm: "rw",
        },
      };
    } catch (e) {
      // console.error("Error while reading attachment", name, e);
      throw Error(`Could not read attachment ${name}`);
    }
  }

  async getAttachmentMeta(name: string): Promise<AttachmentMeta> {
    const localPath = this.attachmentNameToPath(name);
    try {
      const s = await stat(localPath);
      return {
        name: name,
        lastModified: s.mtime.getTime(),
        size: s.size,
        contentType: mime.lookup(name) || "application/octet-stream",
        perm: "rw",
      };
    } catch (e) {
      // console.error("Error while getting attachment meta", name, e);
      throw Error(`Could not get meta for ${name}`);
    }
  }

  async writeAttachment(
    name: string,
    blob: ArrayBuffer,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<AttachmentMeta> {
    let localPath = this.attachmentNameToPath(name);
    try {
      // Ensure parent folder exists
      await mkdir(path.dirname(localPath), { recursive: true });

      // Actually write the file
      await writeFile(localPath, Buffer.from(blob));

      if (lastModified) {
        let d = new Date(lastModified);
        console.log("Going to set the modified time", d);
        await utimes(localPath, d, d);
      }

      // Fetch new metadata
      const s = await stat(localPath);
      return {
        name: name,
        lastModified: s.mtime.getTime(),
        size: s.size,
        contentType: mime.lookup(name) || "application/octet-stream",
        perm: "rw",
      };
    } catch (e) {
      console.error("Error while writing attachment", name, e);
      throw Error(`Could not write ${name}`);
    }
  }

  async deleteAttachment(name: string): Promise<void> {
    let localPath = this.attachmentNameToPath(name);
    await unlink(localPath);
  }

  // Plugs
  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any> {
    return plug.invoke(name, args);
  }

  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return plug.syscall(name, args);
  }
}
