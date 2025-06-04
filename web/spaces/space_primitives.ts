import type { FileMeta } from "../../plug-api/types.ts";

/**
 * A generic interface used by `Space` to interact with the underlying storage, designed to be easy to implement for different storage backends
 */
export interface SpacePrimitives {
  fetchFileList(): Promise<FileMeta[]>;

  // The result of this should be consistent with the result of fetchFileList for this entry
  getFileMeta(name: string): Promise<FileMeta>;

  readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }>;

  writeFile(
    name: string,
    data: Uint8Array,
    // Used to decide whether or not to emit change events
    selfUpdate?: boolean,
    // May be ignored, but ideally should be used to set the lastModified time
    meta?: FileMeta,
  ): Promise<FileMeta>;

  deleteFile(name: string): Promise<void>;
}
