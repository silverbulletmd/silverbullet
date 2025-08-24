import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import type { SpacePrimitives } from "./space_primitives.ts";
import { isValidPath } from "@silverbulletmd/silverbullet/lib/ref";

export class CheckPathSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    return (await this.wrapped.fetchFileList()).filter(({ name }) =>
      this.isReadable(name)
    );
  }

  readFile(name: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    if (!this.isReadable(name)) {
      throw new Error("Couldn't write file, path isn't writable");
    }
    return this.wrapped.readFile(name);
  }

  getFileMeta(name: string): Promise<FileMeta> {
    if (!this.isReadable(name)) {
      throw new Error("Couldn't get file meta, path isn't writable");
    }
    return this.wrapped.getFileMeta(name);
  }

  writeFile(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean | undefined,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    if (!this.isWritable(name)) {
      throw new Error("Couldn't write file, path is invalid");
    }
    return this.wrapped.writeFile(name, data, selfUpdate, meta);
  }

  deleteFile(name: string): Promise<void> {
    // We allow deletion of paths we can't write to. This is for the case when
    // the user has an invalidly named file in their space and they need to
    // remove it/rename it
    if (!this.isReadable(name)) {
      throw new Error("Couldn't delete file, path isn't writable");
    }
    return this.wrapped.deleteFile(name);
  }

  private isReadable(path: string): boolean {
    return !path.startsWith(".");
  }

  private isWritable(path: string): boolean {
    return this.isReadable(path) && isValidPath(path);
  }
}
