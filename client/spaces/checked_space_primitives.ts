import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import type { SpacePrimitives } from "./space_primitives.ts";
import { isValidPath } from "@silverbulletmd/silverbullet/lib/ref";

/**
 * Adds checks for two things:
 * 1. Allowed path names
 * 2. Permissions
 */
export class CheckedSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private readOnly: boolean,
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

  async writeFile(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    if (!await this.isWritable(path)) {
      throw new Error("Couldn't write file, path is not writable");
    }
    return this.wrapped.writeFile(path, data, meta);
  }

  async deleteFile(path: string): Promise<void> {
    // We allow deletion of paths we can't write to. This is for the case when
    // the user has an invalidly named file in their space and they need to
    // remove it/rename it
    if (!await this.isWritable(path)) {
      throw new Error("Couldn't delete file, path is not writable");
    }
    return this.wrapped.deleteFile(path);
  }

  private isReadable(path: string): boolean {
    return !path.startsWith(".");
  }

  private async isWritable(path: string): Promise<boolean> {
    if (this.readOnly) {
      return false;
    }
    try {
      const fileMeta = await this.getFileMeta(path);
      if (fileMeta.perm === "ro") {
        return false;
      }
    } catch {
      // Assumption, not found, that's ok
    }
    return this.isReadable(path) && isValidPath(path);
  }
}
