import type { SysCallMapping } from "../system.ts";
import { path } from "../../dep_server.ts";
import { base64Decode, base64Encode } from "../../common/base64.ts";
export type FileMeta = {
  name: string;
  lastModified: number;
};

export default function fileSystemSyscalls(root = "/"): SysCallMapping {
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
      encoding: "utf8" | "dataurl" = "utf8",
    ): Promise<{ text: string; meta: FileMeta }> => {
      let p = resolvedPath(filePath);
      let text = "";
      if (encoding === "utf8") {
        text = await Deno.readTextFile(p);
      } else {
        text = `data:application/octet-stream,${
          base64Encode(await Deno.readFile(p))
        }`;
      }
      let s = await Deno.stat(p);
      return {
        text,
        meta: {
          name: filePath,
          lastModified: s.mtime!.getTime(),
        },
      };
    },
    "fs.getFileMeta": async (ctx, filePath: string): Promise<FileMeta> => {
      let p = resolvedPath(filePath);
      let s = await Deno.stat(p);
      return {
        name: filePath,
        lastModified: s.mtime!.getTime(),
      };
    },
    "fs.writeFile": async (
      ctx,
      filePath: string,
      text: string,
      encoding: "utf8" | "dataurl" = "utf8",
    ): Promise<FileMeta> => {
      let p = resolvedPath(filePath);
      await Deno.mkdir(path.dirname(p), { recursive: true });
      if (encoding === "utf8") {
        await Deno.writeTextFile(p, text);
      } else {
        await Deno.writeFile(p, base64Decode(text.split(",")[1]));
      }
      let s = await Deno.stat(p);
      return {
        name: filePath,
        lastModified: s.mtime!.getTime(),
      };
    },
    "fs.deleteFile": async (ctx, filePath: string): Promise<void> => {
      let p = resolvedPath(filePath);
      await Deno.remove(p);
    },
    "fs.listFiles": async (
      ctx,
      dirPath: string,
      recursive: boolean,
    ): Promise<FileMeta[]> => {
      dirPath = resolvedPath(dirPath);
      let allFiles: FileMeta[] = [];

      async function walkPath(dir: string) {
        let files = await Deno.readDir(dir);
        for await (const file of files) {
          const fullPath = path.join(dir, file.name);
          let s = await Deno.stat(fullPath);
          if (s.isDirectory && recursive) {
            await walkPath(fullPath);
          } else {
            allFiles.push({
              name: fullPath.substring(dirPath.length + 1),
              lastModified: s.mtime!.getTime(),
            });
          }
        }
      }
      await walkPath(dirPath);
      return allFiles;
    },
  };
}
