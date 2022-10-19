import type { SysCallMapping } from "../system.ts";
import { mime, path, walk } from "../deps.ts";
import { base64DecodeDataUrl, base64Encode } from "../asset_bundle/base64.ts";
import { FileMeta } from "../../common/types.ts";

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
    ): Promise<string> => {
      const p = resolvedPath(filePath);
      let text = "";
      if (encoding === "utf8") {
        text = await Deno.readTextFile(p);
      } else {
        text = `data:application/octet-stream,${
          base64Encode(await Deno.readFile(p))
        }`;
      }
      return text;
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
        await Deno.writeFile(p, base64DecodeDataUrl(text));
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
      for await (
        const file of walk(dirPath, {
          includeDirs: false,
          // Exclude hidden files
          skip: [/^.*\/\..+$/],
          maxDepth: recursive ? Infinity : 1,
        })
      ) {
        const fullPath = file.path;
        const s = await Deno.stat(fullPath);
        allFiles.push({
          name: fullPath.substring(dirPath.length + 1),
          lastModified: s.mtime!.getTime(),
          contentType: mime.getType(fullPath) || "application/octet-stream",
          size: s.size,
          perm: "rw",
        });
      }
      return allFiles;
    },
  };
}
