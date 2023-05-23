import { FileMeta } from "../types.ts";
import type { SpacePrimitives } from "./space_primitives.ts";

/**
 * FallbackSpacePrimitives is a SpacePrimitives implementation that will try to fall back to another SpacePrimitives implementation for two
 * operations:
 *  - readFile
 *  - getFileMeta
 * The use case is primarily sync: when sync hasn't completed yet, we can fall back to HttpSpacePrimitives to fetch the file from the server.
 */
export class FallbackSpacePrimitives implements SpacePrimitives {
  constructor(
    private primary: SpacePrimitives,
    private fallback: SpacePrimitives,
  ) {
  }
  fetchFileList(): Promise<FileMeta[]> {
    return this.primary.fetchFileList();
  }
  async readFile(name: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    try {
      return await this.primary.readFile(name);
    } catch {
      return this.fallback.readFile(name);
    }
  }
  async getFileMeta(name: string): Promise<FileMeta> {
    try {
      return await this.primary.getFileMeta(name);
    } catch {
      return this.fallback.getFileMeta(name);
    }
  }
  writeFile(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean | undefined,
    lastModified?: number | undefined,
  ): Promise<FileMeta> {
    return this.primary.writeFile(name, data, selfUpdate, lastModified);
  }
  deleteFile(name: string): Promise<void> {
    return this.primary.deleteFile(name);
  }
}
