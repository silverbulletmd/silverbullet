import { FileMeta } from "../../plug-api/types.ts";
import { SpacePrimitives } from "./space_primitives.ts";

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
  async readFile(name: string): Promise<{ meta: FileMeta; data: Uint8Array }> {
    const { meta, data } = await this.wrapped.readFile(name);
    return {
      meta: {
        ...meta,
        perm: "ro",
      },
      data,
    };
  }
  async getFileMeta(name: string): Promise<FileMeta> {
    const meta = await this.wrapped.getFileMeta(name);
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
