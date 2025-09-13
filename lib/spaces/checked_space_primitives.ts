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

  readFile(path: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    if (!this.isReadable(path)) {
      throw new Error("Couldn't write file, path isn't writable");
    }
    return this.wrapped.readFile(path);
  }

  getFileMeta(path: string, observing?: boolean): Promise<FileMeta> {
    if (!this.isReadable(path)) {
      throw new Error("Couldn't get file meta, path isn't writable");
    }
    return this.wrapped.getFileMeta(path, observing);
  }

  writeFile(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    if (!this.isWritable(path)) {
      throw new Error("Couldn't write file, path is invalid");
    }
    return this.wrapped.writeFile(path, data, meta);
  }

  deleteFile(path: string): Promise<void> {
    // We allow deletion of paths we can't write to. This is for the case when
    // the user has an invalidly named file in their space and they need to
    // remove it/rename it
    if (!this.isReadable(path)) {
      throw new Error("Couldn't delete file, path isn't writable");
    }
    return this.wrapped.deleteFile(path);
  }

  private isReadable(path: string): boolean {
    return !path.startsWith(".");
  }

  private isWritable(path: string): boolean {
    return this.isReadable(path) && isValidPath(path);
  }
}
