import { assertEditorWritePath } from "../../plug-api/lib/trusted_script_source.ts";
import { isValidPath } from "@silverbulletmd/silverbullet/lib/ref";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import type { SpacePrimitives } from "./space_primitives.ts";

/**
 * Adds checks for two things:
 * 1. Allowed path names
 * 2. Permissions
 */
export class CheckedSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
    private readOnly: boolean,
    private canBuild = true,
  ) {}

  async fetchFileList(): Promise<FileMeta[]> {
    return (await this.wrapped.fetchFileList())
      .filter(({ name }) => this.isReadable(name))
      .map((meta) => this.visibleMeta(meta));
  }

  async readFile(path: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    if (!this.isReadable(path)) {
      throw new Error("Couldn't read file, path isn't readable");
    }
    const result = await this.wrapped.readFile(path);
    return { ...result, meta: this.visibleMeta(result.meta) };
  }

  async getFileMeta(
    path: string,
    observing?: boolean,
    mode?: "cheap",
  ): Promise<FileMeta> {
    if (!this.isReadable(path)) {
      throw new Error("Couldn't get file meta, path isn't readable");
    }
    return this.visibleMeta(
      await this.wrapped.getFileMeta(path, observing, mode),
    );
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    if (!(await this.isWritable(path))) {
      throw new Error("Couldn't write file, path is not writable");
    }
    return this.wrapped.writeFile(path, data, meta);
  }

  async deleteFile(path: string): Promise<void> {
    // We allow deletion of paths we can't write to. This is for the case when
    // the user has an invalidly named file in their space and they need to
    // remove it/rename it
    if (!(await this.isWritable(path))) {
      throw new Error("Couldn't delete file, path is not writable");
    }
    return this.wrapped.deleteFile(path);
  }

  private visibleMeta(meta: FileMeta): FileMeta {
    if (!this.canBuild) {
      try {
        assertEditorWritePath(meta.name);
      } catch {
        return { ...meta, perm: "ro" };
      }
    }
    return meta;
  }

  private isReadable(path: string): boolean {
    return !path.startsWith(".");
  }

  private async isWritable(path: string): Promise<boolean> {
    if (!this.canBuild) {
      try {
        assertEditorWritePath(path);
      } catch {
        return false;
      }
    }
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
