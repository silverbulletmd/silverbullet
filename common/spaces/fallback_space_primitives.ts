import { FileMeta } from "../../plug-api/types.ts";
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
      if (e.message === "Not found") {
        console.info("Reading file content from fallback for", name);
      } else {
        console.warn(
          `Could not read file ${name} from primary, trying fallback, primary read error`,
          e.message,
        );
      }
      try {
        const result = await this.fallback.readFile(name);
        return {
          data: result.data,
          meta: { ...result.meta, noSync: true },
        };
      } catch (fallbackError: any) {
        console.error("Error during readFile fallback", fallbackError.message);
        // Fallback failed, so let's throw the original error
        throw e;
      }
    }
  }
  async getFileMeta(name: string): Promise<FileMeta> {
    try {
      return await this.primary.getFileMeta(name);
    } catch (e: any) {
      if (e.message === "Not found") {
        console.info("Fetching file meta from fallback for", name);
      } else {
        console.warn(
          `Could not fetch file ${name} metadata from primary, trying fallback, primary read error`,
          e.message,
        );
      }
      try {
        const meta = await this.fallback.getFileMeta(name);
        return { ...meta, noSync: true };
      } catch (fallbackError) {
        console.error(
          "Error during getFileMeta fallback",
          fallbackError.message,
        );
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
