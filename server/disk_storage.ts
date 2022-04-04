import {mkdir, readdir, readFile, stat, unlink, writeFile} from "fs/promises";
import * as path from "path";
import {PageMeta} from "../common/types";
import {EventHook} from "../plugos/hooks/event";

export interface Storage {
  listPages(): Promise<PageMeta[]>;

  readPage(pageName: string): Promise<{ text: string; meta: PageMeta }>;

  writePage(pageName: string, text: string): Promise<PageMeta>;

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

  async writePage(pageName: string, text: string): Promise<PageMeta> {
    const newPageMeta = this.wrapped.writePage(pageName, text);
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

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  async listPages(): Promise<PageMeta[]> {
    let fileNames: PageMeta[] = [];

    const walkPath = async (dir: string) => {
      let files = await readdir(dir);
      for (let file of files) {
        const fullPath = path.join(dir, file);
        let s = await stat(fullPath);
        if (s.isDirectory()) {
          await walkPath(fullPath);
        } else {
          if (path.extname(file) === ".md") {
            fileNames.push({
              name: fullPath.substring(
                this.rootPath.length + 1,
                fullPath.length - 3
              ),
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
    const localPath = path.join(this.rootPath, pageName + ".md");
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

  async writePage(pageName: string, text: string): Promise<PageMeta> {
    let localPath = path.join(this.rootPath, pageName + ".md");
    try {
      // Ensure parent folder exists
      await mkdir(path.dirname(localPath), { recursive: true });

      // Actually write the file
      await writeFile(localPath, text);

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
    let localPath = path.join(this.rootPath, pageName + ".md");
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
    let localPath = path.join(this.rootPath, pageName + ".md");
    await unlink(localPath);
  }
}
