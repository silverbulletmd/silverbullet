import type { SysCallMapping } from "../system.ts";
import { mime, path } from "../../server/deps.ts";
import { base64Decode, base64Encode } from "../../plugos/base64.ts";
import type { FileMeta } from "../asset_bundle_reader.ts";

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
      _ctx,
      filePath: string,
      encoding: "utf8" | "dataurl" = "utf8",
    ): Promise<{ text: string; meta: FileMeta }> => {
      const p = resolvedPath(filePath);
      let text = "";
      if (encoding === "utf8") {
        text = await Deno.readTextFile(p);
      } else {
        text = `data:application/octet-stream,${
          base64Encode(await Deno.readFile(p))
        }`;
      }
      const s = await Deno.stat(p);
      return {
        text,
        meta: {
          name: filePath,
          lastModified: s.mtime!.getTime(),
          contentType: mime.getType(filePath) || "application/octet-stream",
          size: s.size,
          perm: "rw",
        },
      };
    },
    "fs.getFileMeta": async (_ctx, filePath: string): Promise<FileMeta> => {
      const p = resolvedPath(filePath);
      const s = await Deno.stat(p);
      return {
        name: filePath,
        lastModified: s.mtime!.getTime(),
        contentType: mime.getType(filePath) || "application/octet-stream",
        size: s.size,
        perm: "rw",
      };
    },
    "fs.writeFile": async (
      _ctx,
      filePath: string,
      text: string,
      encoding: "utf8" | "dataurl" = "utf8",
    ): Promise<FileMeta> => {
      const p = resolvedPath(filePath);
      await Deno.mkdir(path.dirname(p), { recursive: true });
      if (encoding === "utf8") {
        await Deno.writeTextFile(p, text);
      } else {
        await Deno.writeFile(p, base64Decode(text.split(",")[1]));
      }
      const s = await Deno.stat(p);
      return {
        name: filePath,
        lastModified: s.mtime!.getTime(),
        contentType: mime.getType(filePath) || "application/octet-stream",
        size: s.size,
        perm: "rw",
      };
    },
    "fs.deleteFile": async (_ctx, filePath: string): Promise<void> => {
      await Deno.remove(resolvedPath(filePath));
    },
    "fs.listFiles": async (
      _ctx,
      dirPath: string,
      recursive: boolean,
    ): Promise<FileMeta[]> => {
      dirPath = resolvedPath(dirPath);
      const allFiles: FileMeta[] = [];

      async function walkPath(dir: string) {
        const files = await Deno.readDir(dir);
        for await (const file of files) {
          const fullPath = path.join(dir, file.name);
          const s = await Deno.stat(fullPath);
          if (s.isDirectory && recursive) {
            await walkPath(fullPath);
          } else {
            allFiles.push({
              name: fullPath.substring(dirPath.length + 1),
              lastModified: s.mtime!.getTime(),
              contentType: mime.getType(fullPath) || "application/octet-stream",
              size: s.size,
              perm: "rw",
            });
          }
        }
      }
      await walkPath(dirPath);
      return allFiles;
    },
  };
}
