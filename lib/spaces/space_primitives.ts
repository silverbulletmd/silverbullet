import type { FileMeta } from "../../type/index.ts";

/**
 * A generic interface used by `Space` to interact with the underlying storage, designed to be easy to implement for different storage backends
 */
export interface SpacePrimitives {
  fetchFileList(): Promise<FileMeta[]>;

  /**
   * Retrieves metadata for a specific file.
   * @param path The path of the file to retrieve metadata for.
   * @param observing used to hint at the sync engine this file is under regular observation (and may sync more aggressively)
   */
  getFileMeta(path: string, observing?: boolean): Promise<FileMeta>;

  readFile(
    path: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }>;

  writeFile(
    path: string,
    data: Uint8Array,
    // Used to decide whether or not to emit change events
    selfUpdate?: boolean,
    // May be ignored, but ideally should be used to set the lastModified time
    meta?: FileMeta,
  ): Promise<FileMeta>;

  deleteFile(path: string): Promise<void>;
}
