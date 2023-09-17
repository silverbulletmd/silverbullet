import { SpacePrimitives } from "./space_primitives.ts";
import { FileMeta } from "$sb/types.ts";
import { DataStore } from "../../plugos/lib/datastore.ts";

// Enriches the file list listing with custom metadata from the page index
export class FileMetaSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private datastore: DataStore,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const files = await this.wrapped.fetchFileList();
    // Enrich the file list with custom meta data (for pages)
    const allFilesMap: Map<string, any> = new Map(
      files.map((fm) => [fm.name, fm]),
    );
    for (
      const { value } of await this.datastore.query({
        prefix: ["ds", "index", "index", "$page"],
      })
    ) {
      const p = allFilesMap.get(`${value.name}.md`);
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
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    return this.wrapped.readFile(name);
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    const meta = await this.wrapped.getFileMeta(name);
    if (name.endsWith(".md")) {
      const pageName = name.slice(0, -3);
      const additionalMeta = await this.datastore.get([
        "ds",
        "index",
        "index",
        "$page",
        pageName,
      ]);
      if (additionalMeta) {
        for (const [k, v] of Object.entries(additionalMeta)) {
          if (
            ["name", "lastModified", "size", "perm", "contentType"].includes(k)
          ) {
            continue;
          }
          meta[k] = v;
        }
      }
    }
    return meta;
  }

  writeFile(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    return this.wrapped.writeFile(
      name,
      data,
      selfUpdate,
      meta,
    );
  }

  deleteFile(name: string): Promise<void> {
    return this.wrapped.deleteFile(name);
  }
}
