import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import type { SpacePrimitives } from "./space_primitives.ts";
import { isValidPath } from "@silverbulletmd/silverbullet/lib/ref";

export class CheckPathSpacePrimitives implements SpacePrimitives {
  constructor(
    private wrapped: SpacePrimitives,
  ) {
  }

  async fetchFileList(): Promise<FileMeta[]> {
    return await this.wrapped.fetchFileList();
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
    meta?: FileMeta,
  ): Promise<FileMeta> {
    if (!this.checkPath(name)) {
      throw new Error("Couldn't write file, path is invalid");
    }
    return this.wrapped.writeFile(name, data, selfUpdate, meta);
  }

  deleteFile(name: string): Promise<void> {
    return this.wrapped.deleteFile(name);
  }

  private checkPath(path: string): boolean {
    return isValidPath(path);
  }
}
