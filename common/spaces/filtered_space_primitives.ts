import { FileMeta } from "../types.ts";
import { SpacePrimitives } from "./space_primitives.ts";

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
  readFile(name: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    return this.wrapped.readFile(name);
  }
  getFileMeta(name: string): Promise<FileMeta> {
    return this.wrapped.getFileMeta(name);
  }
  writeFile(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean | undefined,
    lastModified?: number | undefined,
  ): Promise<FileMeta> {
    return this.wrapped.writeFile(name, data, selfUpdate, lastModified);
  }
  deleteFile(name: string): Promise<void> {
    return this.wrapped.deleteFile(name);
  }
}
