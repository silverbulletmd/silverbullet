import { DB } from "../src/db.ts";
import { loadFile, writeFile } from "./vfs.js";
import { compile, instantiateBrowser } from "../build/sqlite.js";

export { SqliteError } from "../src/error.ts";
export { Status } from "../src/constants.ts";

const hasCompiled = compile();

/**
 * Opens a database with the given name. If `file` is
 * not provided or `:memory:`, an in-memory database
 * is returned which will not persist after the database
 * is closed.
 */
export async function open(file?: string): Promise<DB> {
  if (file != null && file !== ":memory:") await loadFile(file);
  await hasCompiled;
  await instantiateBrowser();
  return new DB(file);
}

/**
 * Overwrite a given file with arbitrary data. This can be used
 * to import a database which can later be opened.
 */
export async function write(file: string, data: Uint8Array): Promise<void> {
  await writeFile(file, data);
}

/**
 * Read the data currently stored for a given file. This can be used
 * to export a database which has been created or modified.
 */
export async function read(file: string): Promise<Uint8Array | null> {
  const buffer = await loadFile(file);
  return buffer?.toUint8Array()?.slice();
}
