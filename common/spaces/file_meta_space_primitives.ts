import { Plug } from "../../plugos/plug.ts";
import { FileMeta } from "../types.ts";
import { FileData, FileEncoding, SpacePrimitives } from "./space_primitives.ts";
import type { SysCallMapping } from "../../plugos/system.ts";

// Enriches the file list listing with custom metadata from the page index
export class FileMetaSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private indexSyscalls: SysCallMapping,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const files = await this.wrapped.fetchFileList();
    // Enrich the file list with custom meta data (for pages)
    const allFilesMap: Map<string, any> = new Map(
      files.map((fm) => [fm.name, fm]),
    );
    for (
      const { page, value } of await this.indexSyscalls["index.queryPrefix"](
        {} as any,
        "meta:",
      )
    ) {
      const p = allFilesMap.get(`${page}.md`);
      if (p) {
        for (const [k, v] of Object.entries(value)) {
          if (
            ["name", "lastModified", "size", "perm", "contentType"].includes(k)
          ) {
            continue;
          }
          p[k] = v;
        }
      }
    }
    return [...allFilesMap.values()];
  }

  readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }> {
    return this.wrapped.readFile(name, encoding);
  }

  getFileMeta(name: string): Promise<FileMeta> {
    return this.wrapped.getFileMeta(name);
  }

  writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
    selfUpdate?: boolean,
  ): Promise<FileMeta> {
    return this.wrapped.writeFile(name, encoding, data, selfUpdate);
  }

  deleteFile(name: string): Promise<void> {
    return this.wrapped.deleteFile(name);
  }

  // deno-lint-ignore no-explicit-any
  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return this.wrapped.proxySyscall(plug, name, args);
  }

  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[],
  ): Promise<any> {
    return this.wrapped.invokeFunction(plug, env, name, args);
  }
}
