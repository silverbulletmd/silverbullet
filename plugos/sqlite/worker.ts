// This file is never loaded directly, it's loaded via a bundle. Run `deno task generate` to update.
import { DB } from "./deno-sqlite/mod.ts";

let db: DB | undefined;

import { compile } from "./deno-sqlite/build/sqlite.js";
const ready = compile();

globalThis.addEventListener("message", (event: MessageEvent) => {
  const { data } = event;
  // console.log("Got message", data);
  ready.then(() => {
    switch (data.type) {
      case "init": {
        try {
          db = new DB(data.dbPath);
        } catch (e: any) {
          // console.error("Error!!!", e, data);
          respondError(data.id, e);
          break;
        }
        respond(data.id, true);
        break;
      }
      case "execute": {
        if (!db) {
          respondError(data.id, new Error("Not initialized"));
          break;
        }
        try {
          db.query(data.query, data.params);
          respond(data.id, db.changes);
        } catch (e: any) {
          respondError(data.id, e);
        }
        break;
      }
      case "query": {
        if (!db) {
          respondError(data.id, new Error("Not initialized"));
          break;
        }
        try {
          const result = db.queryEntries(data.query, data.params);
          respond(data.id, result);
        } catch (e: any) {
          respondError(data.id, e);
        }
        break;
      }
    }
  }).catch(console.error);
});

function respond(id: number, result: any) {
  globalThis.postMessage({ id, result });
}

function respondError(id: number, error: Error) {
  globalThis.postMessage({ id, error: error.message });
}
