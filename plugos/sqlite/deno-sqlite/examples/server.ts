/**
 * server.ts
 *
 * A server which returns the number
 * of hits to any given path since
 * the server started running.
 *
 * This is an example, meant to illustrate using
 * the API provided by deno-sqlite.
 */

import { serve } from "https://deno.land/std@0.134.0/http/mod.ts";
import { DB } from "../mod.ts";

const db = new DB();

db.query(`
  CREATE TABLE visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    visited_at TEXT NOT NULL
  )
`);

const addVisitQuery = db.prepareQuery(
  "INSERT INTO visits (url, visited_at) VALUES (:url, :time)",
);
const countVisitsQuery = db.prepareQuery<[number]>(
  "SELECT COUNT(*) FROM visits WHERE url = :url",
);

console.log("Running server on localhost:8080");

await serve((req) => {
  addVisitQuery.execute({
    url: req.url,
    time: new Date(),
  });

  const [count] = countVisitsQuery.one({ url: req.url });
  return new Response(`This page was visited ${count} times!`);
}, { port: 8080 });
