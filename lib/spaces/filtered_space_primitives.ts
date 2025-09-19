import type { SpacePrimitives } from "./space_primitives.ts";
import type { FileMeta } from "../../plug-api/types/index.ts";

export class FilteredSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private filterFn: (name: FileMeta) => boolean,
    private onFetchList?: () => Promise<void>,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    if (this.onFetchList) {
      await this.onFetchList();
    }
    return (await this.wrapped.fetchFileList()).filter(this.filterFn);
  }

  readFile(path: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    return this.wrapped.readFile(path);
  }

  getFileMeta(path: string, observing?: boolean): Promise<FileMeta> {
    return this.wrapped.getFileMeta(path, observing);
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
}
