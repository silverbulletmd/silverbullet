import { readdir, readFile, stat, writeFile, unlink, mkdir } from "fs/promises";
import path from "path";
import type { SysCallMapping } from "../system";

export type FileMeta = {
  name: string;
  lastModified: number;
};

export default function fileSystemSyscalls(root: string = "/"): SysCallMapping {
  function resolvedPath(p: string): string {
    p = path.resolve(root, p);
    if (!p.startsWith(root)) {
      throw Error("Path outside root, not allowed");
    }
    return p;
  }

  return {
    "fs.readFile": async (
      ctx,
      filePath: string,
      encoding: "utf8" | "dataurl" = "utf8"
    ): Promise<{ text: string; meta: FileMeta }> => {
      let p = resolvedPath(filePath);
      let text = "";
      if (encoding === "utf8") {
        text = await readFile(p, "utf8");
      } else {
        text = `data:application/octet-stream,${await readFile(p, "base64")}`;
      }
      let s = await stat(p);
      return {
        text,
        meta: {
          name: filePath,
          lastModified: s.mtime.getTime(),
        },
      };
    },
    "fs.getFileMeta": async (ctx, filePath: string): Promise<FileMeta> => {
      let p = resolvedPath(filePath);
      let s = await stat(p);
      return {
        name: filePath,
        lastModified: s.mtime.getTime(),
      };
    },
    "fs.writeFile": async (
      ctx,
      filePath: string,
      text: string,
      encoding: "utf8" | "dataurl" = "utf8"
    ): Promise<FileMeta> => {
      let p = resolvedPath(filePath);
      await mkdir(path.dirname(p), { recursive: true });
      if (encoding === "utf8") {
        await writeFile(p, text);
      } else {
        await writeFile(p, text.split(",")[1], {
          encoding: "base64",
        });
      }
      let s = await stat(p);
      return {
        name: filePath,
        lastModified: s.mtime.getTime(),
      };
    },
    "fs.deleteFile": async (ctx, filePath: string): Promise<void> => {
      let p = resolvedPath(filePath);
      await unlink(p);
    },
    "fs.listFiles": async (
      ctx,
      dirPath: string,
      recursive: boolean
    ): Promise<FileMeta[]> => {
      dirPath = resolvedPath(dirPath);
      let allFiles: FileMeta[] = [];

      async function walkPath(dir: string) {
        let files = await readdir(dir);
        for (let file of files) {
          const fullPath = path.join(dir, file);
          let s = await stat(fullPath);
          if (s.isDirectory() && recursive) {
            await walkPath(fullPath);
          } else {
            allFiles.push({
              name: fullPath.substring(dirPath.length + 1),
              lastModified: s.mtime.getTime(),
            });
          }
        }
      }
      await walkPath(dirPath);
      return allFiles;
    },
  };
}
