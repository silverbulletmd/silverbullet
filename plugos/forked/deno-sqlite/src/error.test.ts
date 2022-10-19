import {
  assertEquals,
  assertInstanceOf,
  assertThrows,
} from "https://deno.land/std@0.154.0/testing/asserts.ts";

import { DB, SqliteError, Status } from "../mod.ts";

Deno.test("invalid SQL", function () {
  const db = new DB();
  const queries = [
    "INSERT INTO does_not_exist (balance) VALUES (5)",
    "this is not sql",
    ";;;",
  ];
  for (const query of queries) assertThrows(() => db.query(query));

  db.close();
});

Deno.test("constraint error code is correct", function () {
  const db = new DB();
  db.query("CREATE TABLE test (name TEXT PRIMARY KEY)");
  db.query("INSERT INTO test (name) VALUES (?)", ["A"]);

  assertThrows(
    () => db.query("INSERT INTO test (name) VALUES (?)", ["A"]),
    (e: Error) => {
      assertInstanceOf(e, SqliteError);
      assertEquals(e.code, Status.SqliteConstraint, "Got wrong error code");
      assertEquals(
        Status[e.codeName],
        Status.SqliteConstraint,
        "Got wrong error code name",
      );
    },
  );
});

Deno.test("syntax error code is correct", function () {
  const db = new DB();

  assertThrows(
    () => db.query("CREATE TABLEX test (name TEXT PRIMARY KEY)"),
    (e: Error) => {
      assertInstanceOf(e, SqliteError);
      assertEquals(e.code, Status.SqliteError, "Got wrong error code");
      assertEquals(
        Status[e.codeName],
        Status.SqliteError,
        "Got wrong error code name",
      );
    },
  );
});
