import { mkdir, readdir, readFile, stat, unlink, utimes, writeFile } from "fs/promises";
import * as path from "path";
import { PageMeta } from "../common/types";
import { EventHook } from "../plugos/hooks/event";

export interface Storage {
  listPages(): Promise<PageMeta[]>;
  readPage(pageName: string): Promise<{ text: string; meta: PageMeta }>;
  writePage(
    pageName: string,
    text: string,
    lastModified?: number
  ): Promise<PageMeta>;
  getPageMeta(pageName: string): Promise<PageMeta>;
  deletePage(pageName: string): Promise<void>;
}

export class EventedStorage implements Storage {
  constructor(private wrapped: Storage, private eventHook: EventHook) {}

  listPages(): Promise<PageMeta[]> {
    return this.wrapped.listPages();
  }

  readPage(pageName: string): Promise<{ text: string; meta: PageMeta }> {
    return this.wrapped.readPage(pageName);
  }

  async writePage(
    pageName: string,
    text: string,
    lastModified?: number
  ): Promise<PageMeta> {
    const newPageMeta = this.wrapped.writePage(pageName, text, lastModified);
    // This can happen async
    this.eventHook
      .dispatchEvent("page:saved", pageName)
      .then(() => {
        return this.eventHook.dispatchEvent("page:index", {
          name: pageName,
          text: text,
        });
      })
      .catch((e) => {
        console.error("Error dispatching page:saved event", e);
      });
    return newPageMeta;
  }

  getPageMeta(pageName: string): Promise<PageMeta> {
    return this.wrapped.getPageMeta(pageName);
  }

  async deletePage(pageName: string): Promise<void> {
    await this.eventHook.dispatchEvent("page:deleted", pageName);
    return this.wrapped.deletePage(pageName);
  }
}

export class DiskStorage implements Storage {
  rootPath: string;
  plugPrefix: string;

  constructor(rootPath: string, plugPrefix: string = "_plug/") {
    this.rootPath = rootPath;
    this.plugPrefix = plugPrefix;
  }

  pageNameToPath(pageName: string) {
    if (pageName.startsWith(this.plugPrefix)) {
      return path.join(this.rootPath, pageName + ".plug.json");
    }
    return path.join(this.rootPath, pageName + ".md");
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

  async listPages(): Promise<PageMeta[]> {
    let fileNames: PageMeta[] = [];

    const walkPath = async (dir: string) => {
      let files = await readdir(dir);
      for (let file of files) {
        const fullPath = path.join(dir, file);
        let s = await stat(fullPath);
        // console.log("Encountering", fullPath, s);
        if (s.isDirectory()) {
          await walkPath(fullPath);
        } else {
          if (file.endsWith(".md") || file.endsWith(".json")) {
            fileNames.push({
              name: this.pathToPageName(fullPath),
              lastModified: s.mtime.getTime(),
            });
          }
        }
      }
    };
    await walkPath(this.rootPath);
    return fileNames;
  }

  async readPage(pageName: string): Promise<{ text: string; meta: PageMeta }> {
    const localPath = this.pageNameToPath(pageName);
    try {
      const s = await stat(localPath);
      return {
        text: await readFile(localPath, "utf8"),
        meta: {
          name: pageName,
          lastModified: s.mtime.getTime(),
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
        await utimes(localPath, lastModified, lastModified);
      }
      // Fetch new metadata
      const s = await stat(localPath);
      return {
        name: pageName,
        lastModified: s.mtime.getTime(),
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
      };
    } catch (e) {
      console.error("Error while getting page meta", pageName, e);
      throw Error(`Could not get meta for ${pageName}`);
    }
  }

  async deletePage(pageName: string): Promise<void> {
    let localPath = this.pageNameToPath(pageName);
    await unlink(localPath);
  }
}
