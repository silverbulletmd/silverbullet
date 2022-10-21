import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.154.0/testing/asserts.ts";

import { DB } from "../mod.ts";

Deno.test("README example", function () {
  const db = new DB(/* in memory */);
  db.execute(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT
    )
  `);

  const name =
    ["Peter Parker", "Clark Kent", "Bruce Wane"][Math.floor(Math.random() * 3)];

  // Run a simple query
  db.query("INSERT INTO people (name) VALUES (?)", [name]);

  // Print out data in table
  for (const [_name] of db.query("SELECT name FROM people")) continue; // no console.log ;)

  db.close();
});

Deno.test("old README example", function () {
  const db = new DB();
  const first = ["Bruce", "Clark", "Peter"];
  const last = ["Wane", "Kent", "Parker"];
  db.query(
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, subscribed INTEGER)",
  );

  for (let i = 0; i < 100; i++) {
    const name = `${first[Math.floor(Math.random() * first.length)]} ${
      last[
        Math.floor(
          Math.random() * last.length,
        )
      ]
    }`;
    const email = `${name.replace(" ", "-")}@deno.land`;
    const subscribed = Math.random() > 0.5 ? true : false;
    db.query("INSERT INTO users (name, email, subscribed) VALUES (?, ?, ?)", [
      name,
      email,
      subscribed,
    ]);
  }

  for (
    const [
      name,
      email,
    ] of db.query<[string, string]>(
      "SELECT name, email FROM users WHERE subscribed = ? LIMIT 100",
      [true],
    )
  ) {
    assertMatch(name, /(Bruce|Clark|Peter) (Wane|Kent|Parker)/);
    assertEquals(email, `${name.replace(" ", "-")}@deno.land`);
  }

  const res = db.query("SELECT email FROM users WHERE name LIKE ?", [
    "Robert Parr",
  ]);
  assertEquals(res, []);

  const subscribers = db.query(
    "SELECT name, email FROM users WHERE subscribed = ?",
    [true],
  );
  for (const [_name, _email] of subscribers) {
    if (Math.random() > 0.5) continue;
    break;
  }
});
