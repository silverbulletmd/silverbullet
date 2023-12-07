import { DenoKvPrimitives } from "../plugos/lib/deno_kv_primitives.ts";
import { KvPrimitives } from "../plugos/lib/kv_primitives.ts";
import { path } from "./deps.ts";

/**
 * Environment variables:
 * - SB_DB_BACKEND: "denokv" or "off" (default: denokv)
 * - SB_DB_FILE (denokv only): path to the database file (default .silverbullet.db) or ":cloud:" for cloud storage
 */

export async function determineDatabaseBackend(
  pagesPath: string,
): Promise<KvPrimitives | null> {
  const backendConfig = Deno.env.get("SB_DB_BACKEND") || "denokv";
  switch (backendConfig) {
    case "denokv": {
      let dbFile: string | undefined = Deno.env.get("SB_DB_FILE") ||
        ".silverbullet.db";
      if (dbFile !== ":cloud:") {
        dbFile = path.resolve(
          path.dirname(pagesPath),
          dbFile,
        );
      } else {
        dbFile = undefined; // Deno Deploy will use the default KV store
      }
      const denoDb = await Deno.openKv(dbFile);
      console.info(
        `Using DenoKV as a database backend (${dbFile}), running in server-processing mode.`,
      );
      return new DenoKvPrimitives(denoDb);
    }
    default:
      console.info(
        "Running in databaseless mode: no server-side indexing and state keeping (beyond space files) will happen.",
      );
      return null;
  }
}
