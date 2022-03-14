import { readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { PageMeta, pagesPath } from "./server";

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
    const localPath = path.join(pagesPath, pageName + ".md");
    const s = await stat(localPath);
    return {
      text: await readFile(localPath, "utf8"),
      meta: {
        name: pageName,
        lastModified: s.mtime.getTime(),
      },
    };
  }

  async writePage(pageName: string, text: string): Promise<PageMeta> {
    let localPath = path.join(pagesPath, pageName + ".md");
    // await pipeline(body, fs.createWriteStream(localPath));
    await writeFile(localPath, text);

    // console.log(`Wrote to ${localPath}`);
    const s = await stat(localPath);
    return {
      name: pageName,
      lastModified: s.mtime.getTime(),
    };
  }

  async getPageMeta(pageName: string): Promise<PageMeta> {
    let localPath = path.join(pagesPath, pageName + ".md");
    const s = await stat(localPath);
    return {
      name: pageName,
      lastModified: s.mtime.getTime(),
    };
  }

  async deletePage(pageName: string) {
    let localPath = path.join(pagesPath, pageName + ".md");
    await unlink(localPath);
  }
}
