import type { SpacePrimitives } from "./space_primitives.ts";
import type { FileMeta } from "../../plug-api/types/index.ts";

export class ReadOnlySpacePrimitives implements SpacePrimitives {
  wrapped: SpacePrimitives;

  constructor(wrapped: SpacePrimitives) {
    this.wrapped = wrapped;
  }

  async fetchFileList(): Promise<FileMeta[]> {
    return (await this.wrapped.fetchFileList()).map((f: FileMeta) => ({
      ...f,
      perm: "ro",
    }));
  }

  async readFile(path: string): Promise<{ meta: FileMeta; data: Uint8Array }> {
    const { meta, data } = await this.wrapped.readFile(path);
    return {
      meta: {
        ...meta,
        perm: "ro",
      },
      data,
    };
  }

  async getFileMeta(path: string, observing?: boolean): Promise<FileMeta> {
    const meta = await this.wrapped.getFileMeta(path, observing);
    return {
      ...meta,
      perm: "ro",
    };
  }

  writeFile(): Promise<FileMeta> {
    throw new Error("Read only space, not allowed to write");
  }

  deleteFile(): Promise<void> {
    throw new Error("Read only space, not allowed to delete");
  }
}
