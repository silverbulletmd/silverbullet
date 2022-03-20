import { readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import * as path from "path";
import { PageMeta } from "./types";

export class DiskStorage {
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
      // console.error("Error while writing page", pageName, e);
      throw Error(`Could not read page ${pageName}`);
    }
  }

  async writePage(pageName: string, text: string): Promise<PageMeta> {
    let localPath = path.join(this.rootPath, pageName + ".md");
    try {
      await writeFile(localPath, text);

      // console.log(`Wrote to ${localPath}`);
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

  async deletePage(pageName: string) {
    let localPath = path.join(this.rootPath, pageName + ".md");
    await unlink(localPath);
  }
}
