import type { FileMeta } from "../../plug-api/types/index.ts";

/**
 * Everything in a space in one go. `folders` lists every folder, including
 * those that only exist because files are in them, with paths without a
 * trailing slash ("Projects/Archive"). It's undefined when the backend has
 * no folder support, e.g. an older server.
 */
export type SpaceListing = {
  files: FileMeta[];
  folders?: string[];
};

/**
 * A generic interface used by `Space` to interact with the underlying storage, designed to be easy to implement for different storage backends
 */
export type SpacePrimitives = {
  fetchFileList(): Promise<FileMeta[]>;

  /**
   * Retrieves metadata for a specific file.
   * @param path The path of the file to retrieve metadata for.
   * @param observing used to hint at the sync engine this file is under regular observation (and may sync more aggressively)
   */
  getFileMeta(
    path: string,
    observing?: boolean,
    mode?: "cheap",
  ): Promise<FileMeta>;

  readFile(path: string): Promise<{ data: Uint8Array; meta: FileMeta }>;

  writeFile(
    path: string,
    data: Uint8Array,
    // May be ignored, but ideally should be used to set the lastModified time
    meta?: FileMeta,
  ): Promise<FileMeta>;

  deleteFile(path: string): Promise<void>;

  /**
   * Folders, as in a normal file system: a folder exists until it is
   * deleted, whether or not anything is in it. A backend without folders of
   * its own answers `fetchListing` without `folders` and throws on the rest.
   */

  /** Files and folders in one go. */
  fetchListing(): Promise<SpaceListing>;

  /** Creates the folder and any missing parents; a no-op if it exists. */
  createFolder(path: string): Promise<void>;

  /**
   * Deletes a folder: only an empty one (`folderNotEmptyError` otherwise),
   * unless `recursive`, which deletes everything in it too.
   */
  deleteFolder(path: string, opts?: { recursive?: boolean }): Promise<void>;
};
