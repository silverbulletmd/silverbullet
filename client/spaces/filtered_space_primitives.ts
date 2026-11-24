import type { FileMeta } from "../../plug-api/types/index.ts";
import type { SpaceListing, SpacePrimitives } from "./space_primitives.ts";

export class FilteredSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private filterFn: (name: FileMeta) => boolean,
    private onFetchList?: () => Promise<void>,
  ) {}

  async fetchFileList(): Promise<FileMeta[]> {
    if (this.onFetchList) {
      await this.onFetchList();
    }
    return (await this.wrapped.fetchFileList()).filter(this.filterFn);
  }

  readFile(path: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    return this.wrapped.readFile(path);
  }

  getFileMeta(
    path: string,
    observing?: boolean,
    mode?: "cheap",
  ): Promise<FileMeta> {
    return this.wrapped.getFileMeta(path, observing, mode);
  }

  writeFile(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    return this.wrapped.writeFile(path, data, meta);
  }

  deleteFile(path: string): Promise<void> {
    return this.wrapped.deleteFile(path);
  }

  async fetchListing(): Promise<SpaceListing> {
    if (this.onFetchList) {
      await this.onFetchList();
    }
    const { files, folders } = await this.wrapped.fetchListing();
    return { files: files.filter(this.filterFn), folders };
  }

  createFolder(path: string): Promise<void> {
    return this.wrapped.createFolder(path);
  }

  deleteFolder(path: string, opts?: { recursive?: boolean }): Promise<void> {
    return this.wrapped.deleteFolder(path, opts);
  }
}
