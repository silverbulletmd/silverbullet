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
    } catch (e) {
      try {
        return this.fallback.readFile(name);
      } catch (fallbackError) {
        console.error("Error during reaFile fallback", fallbackError);
        // Fallback failed, so let's throw the original error
        throw e;
      }
    }
  }
  async getFileMeta(name: string): Promise<FileMeta> {
    try {
      return await this.primary.getFileMeta(name);
    } catch (e) {
      try {
        return this.fallback.getFileMeta(name);
      } catch (fallbackError) {
        console.error("Error during getFileMeta fallback", fallbackError);
        // Fallback failed, so let's throw the original error
        throw e;
      }
    }
  }
  writeFile(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean | undefined,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    return this.primary.writeFile(name, data, selfUpdate, meta);
  }
  deleteFile(name: string): Promise<void> {
    return this.primary.deleteFile(name);
  }
}
