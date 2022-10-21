import {
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.154.0/testing/asserts.ts";

import { DB } from "../mod.ts";

const TEST_DB = "test.db";
const LARGE_TEST_DB = "build/2GB_test.db";

async function dbPermissions(path: string): Promise<boolean> {
  const query = async (name: "read" | "write") =>
    (await Deno.permissions.query({ name, path })).state ===
      "granted";
  return await query("read") && await query("write");
}

const TEST_DB_PERMISSIONS = await dbPermissions(TEST_DB);
const LARGE_TEST_DB_PERMISSIONS = await dbPermissions(LARGE_TEST_DB);

async function deleteDatabase(file: string) {
  try {
    await Deno.remove(file);
  } catch { /* no op */ }
  try {
    await Deno.remove(`${file}-journal`);
  } catch { /* no op */ }
}

Deno.test("execute multiple statements", function () {
  const db = new DB();

  db.execute(`
    CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT);

    INSERT INTO test (id) VALUES (1);
    INSERT INTO test (id) VALUES (2);
    INSERT INTO test (id) VALUES (3);
  `);
  assertEquals(db.query("SELECT id FROM test"), [[1], [2], [3]]);

  // table `test` already exists ...
  assertThrows(function () {
    db.execute(`
      CREATE TABLE test2 (id INTEGER);
      CREATE TABLE test (id INTEGER);
    `);
  });

  // ... but table `test2` was created before the error
  assertEquals(db.query("SELECT id FROM test2"), []);

  // syntax error after first valid statement
  assertThrows(() => db.execute("SELECT id FROM test; NOT SQL ANYMORE"));
});

Deno.test("foreign key constraints enabled", function () {
  const db = new DB();
  db.execute(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user INTEGER, FOREIGN KEY(user) REFERENCES users(id));
  `);

  db.query("INSERT INTO users (id) VALUES (1)");
  const [{ id }] = db.queryEntries<{ id: number }>("SELECT id FROM users");

  // user must exist
  assertThrows(() =>
    db.query("INSERT INTO orders (user) VALUES (?)", [id + 1])
  );
  db.query("INSERT INTO orders (user) VALUES (?)", [id]);

  // can't delete if that violates the constraint ...
  assertThrows(() => {
    db.query("DELETE FROM users WHERE id = ?", [id]);
  });

  // ... after deleting the order, deleting is OK
  db.query("DELETE FROM orders WHERE user = ?", [id]);
  db.query("DELETE FROM users WHERE id = ?", [id]);
});

Deno.test("json functions exist", function () {
  const db = new DB();

  // The JSON1 functions should exist and we should be able to call them without unexpected errors
  db.query(`SELECT json('{"this is": ["json"]}')`);

  // We should expect an error if we pass invalid JSON where valid JSON is expected
  assertThrows(() => {
    db.query(`SELECT json('this is not json')`);
  });

  // We should be able to use bound values as arguments to the JSON1 functions,
  // and they should produce the expected results for these simple expressions.
  const [[objectType]] = db.query(`SELECT json_type('{}')`);
  assertEquals(objectType, "object");

  const [[integerType]] = db.query(`SELECT json_type(?)`, ["2"]);
  assertEquals(integerType, "integer");

  const [[realType]] = db.query(`SELECT json_type(?)`, ["2.5"]);
  assertEquals(realType, "real");

  const [[stringType]] = db.query(`SELECT json_type(?)`, [`"hello"`]);
  assertEquals(stringType, "text");

  const [[integerTypeAtPath]] = db.query(
    `SELECT json_type(?, ?)`,
    [`["hello", 2, {"world": 4}]`, `$[2].world`],
  );
  assertEquals(integerTypeAtPath, "integer");
});

Deno.test("date time is correct", function () {
  const db = new DB();
  // the date/ time is passed from JS and should be current (note that it is GMT)
  const [[now]] = [...db.query("SELECT STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')")];
  const jsTime = new Date().getTime();
  const dbTime = new Date(`${now}Z`).getTime();
  // to account for runtime latency, a small difference is ok
  const tolerance = 10;
  assertAlmostEquals(jsTime, dbTime, tolerance);
  db.close();
});

Deno.test("SQL localtime reflects system locale", function () {
  const db = new DB();
  const [[timeDb]] = db.query("SELECT datetime('now', 'localtime')");
  const now = new Date();

  const jsMonth = `${now.getMonth() + 1}`.padStart(2, "0");
  const jsDate = `${now.getDate()}`.padStart(2, "0");
  const jsHour = `${now.getHours()}`.padStart(2, "0");
  const jsMinute = `${now.getMinutes()}`.padStart(2, "0");
  const jsSecond = `${now.getSeconds()}`.padStart(2, "0");
  const timeJs =
    `${now.getFullYear()}-${jsMonth}-${jsDate} ${jsHour}:${jsMinute}:${jsSecond}`;

  assertEquals(timeDb, timeJs);
});

Deno.test("database has correct changes and totalChanges", function () {
  const db = new DB();

  db.execute(
    "CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
  );

  for (const name of ["a", "b", "c"]) {
    db.query("INSERT INTO test (name) VALUES (?)", [name]);
    assertEquals(1, db.changes);
  }

  assertEquals(3, db.totalChanges);

  db.query("UPDATE test SET name = ?", ["new name"]);
  assertEquals(3, db.changes);
  assertEquals(6, db.totalChanges);
});

Deno.test("last inserted id", function () {
  const db = new DB();

  // By default, lastInsertRowId must be 0
  assertEquals(db.lastInsertRowId, 0);

  // Create table and insert value
  db.query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

  const insertRowIds = [];

  // Insert data to table and collect their ids
  for (let i = 0; i < 10; i++) {
    db.query("INSERT INTO users (name) VALUES ('John Doe')");
    insertRowIds.push(db.lastInsertRowId);
  }

  // Now, the last inserted row id must be 10
  assertEquals(db.lastInsertRowId, 10);

  // All collected row ids must be the same as in the database
  assertEquals(
    insertRowIds,
    [...db.query("SELECT id FROM users")].map(([i]) => i),
  );

  db.close();

  // When the database is closed, the value
  // will be reset to 0 again
  assertEquals(db.lastInsertRowId, 0);
});

Deno.test("close database", function () {
  const db = new DB();
  db.close();
  assertThrows(() => db.query("CREATE TABLE test (name TEXT PRIMARY KEY)"));
  db.close(); // check close is idempotent and won't throw
});

Deno.test("open queries block close", function () {
  const db = new DB();
  db.query("CREATE TABLE test (name TEXT PRIMARY KEY)");

  const query = db.prepareQuery("SELECT name FROM test");
  assertThrows(() => db.close());
  query.finalize();

  db.close();
});

Deno.test("open queries cleaned up by forced close", function () {
  const db = new DB();
  db.query("CREATE TABLE test (name TEXT PRIMARY KEY)");
  db.query("INSERT INTO test (name) VALUES (?)", ["Deno"]);

  db.prepareQuery("SELECT name FROM test WHERE name like '%test%'");

  assertThrows(() => db.close());
  db.close(true);
});

Deno.test("invalid bind does not leak statements", function () {
  const db = new DB();
  db.query("CREATE TABLE test (id INTEGER)");

  for (let n = 0; n < 100; n++) {
    assertThrows(() => {
      // deno-lint-ignore no-explicit-any
      const badBinding: any = [{}];
      db.query("INSERT INTO test (id) VALUES (?)", badBinding);
    });
    assertThrows(() => {
      const badBinding = { missingKey: null };
      db.query("INSERT INTO test (id) VALUES (?)", badBinding);
    });
  }

  db.query("INSERT INTO test (id) VALUES (1)");

  db.close();
});

Deno.test("transactions can be nested", function () {
  const db = new DB();
  db.query("CREATE TABLE test (id INTEGER PRIMARY KEY)");

  db.transaction(() => {
    db.query("INSERT INTO test (id) VALUES (1)");
    try {
      db.transaction(() => {
        db.query("INSERT INTO test (id) VALUES (2)");
        throw new Error("boom!");
      });
    } catch (_) { /* ignore */ }
  });

  assertEquals([{ id: 1 }], db.queryEntries("SELECT * FROM test"));
});

Deno.test("transactions commit when closure exists", function () {
  const db = new DB();
  db.query("CREATE TABLE test (id INTEGER PRIMARY KEY)");

  db.transaction(() => {
    db.query("INSERT INTO test (id) VALUES (1)");
  });
  assertThrows(() => db.query("ROLLBACK"));

  assertEquals([{ id: 1 }], db.queryEntries("SELECT * FROM test"));
});

Deno.test("transaction rolls back on throw", function () {
  const db = new DB();
  db.query("CREATE TABLE test (id INTEGER PRIMARY KEY)");

  assertThrows(() => {
    db.transaction(() => {
      db.query("INSERT INTO test (id) VALUES (1)");
      throw new Error("boom!");
    });
  });

  assertEquals([], db.query("SELECT * FROM test"));
});

Deno.test(
  "persist database to file",
  {
    ignore: !TEST_DB_PERMISSIONS,
    permissions: { read: true, write: true },
    sanitizeResources: true,
  },
  async function () {
    const data = [
      "Hello World!",
      "Hello Deno!",
      "JavaScript <3",
      "This costs 0€ / $0 / £0",
      "Wéll, hällö thėrè¿",
    ];

    // ensure the test database file does not exist
    await deleteDatabase(TEST_DB);

    const db = new DB(TEST_DB);
    db.execute(
      "CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, val TEXT)",
    );
    for (const val of data) {
      db.query("INSERT INTO test (val) VALUES (?)", [val]);
    }

    // open the same database with a separate connection
    const readOnlyDb = await new DB(TEST_DB, { mode: "read" });
    for (
      const [id, val] of readOnlyDb.query<[number, string]>(
        "SELECT * FROM test",
      )
    ) {
      assertEquals(data[id - 1], val);
    }

    await Deno.remove(TEST_DB);
    db.close();
    readOnlyDb.close();
  },
);

Deno.test(
  "temporary file database read / write",
  {
    ignore: !TEST_DB_PERMISSIONS,
    permissions: { read: true, write: true },
    sanitizeResources: true,
  },
  function () {
    const data = [
      "Hello World!",
      "Hello Deno!",
      "JavaScript <3",
      "This costs 0€ / $0 / £0",
      "Wéll, hällö thėrè¿",
    ];

    const tempDb = new DB("");
    tempDb.execute(
      "CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, val TEXT)",
    );
    for (const val of data) {
      tempDb.query("INSERT INTO test (val) VALUES (?)", [val]);
    }

    for (
      const [id, val] of tempDb.query<[number, string]>("SELECT * FROM test")
    ) {
      assertEquals(data[id - 1], val);
    }

    tempDb.close();
  },
);

Deno.test(
  "database open options",
  {
    ignore: !TEST_DB_PERMISSIONS,
    permissions: { read: true, write: true },
    sanitizeResources: true,
  },
  async function () {
    await deleteDatabase(TEST_DB);

    // when no file exists, these should error
    assertThrows(() => new DB(TEST_DB, { mode: "write" }));
    assertThrows(() => new DB(TEST_DB, { mode: "read" }));

    // create the database
    const dbCreate = new DB(TEST_DB, { mode: "create" });
    dbCreate.execute(
      "CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
    );
    dbCreate.close();

    // the default mode is create
    await deleteDatabase(TEST_DB);
    const dbCreateDefault = new DB(TEST_DB, { mode: "create" });
    dbCreateDefault.execute(
      "CREATE TABLE test (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
    );
    dbCreateDefault.close();

    // in write mode, we can run INSERT queries ...
    const dbWrite = new DB(TEST_DB, { mode: "write" });
    dbWrite.query("INSERT INTO test (name) VALUES (?)", ["open-options-test"]);
    dbWrite.close();

    // ... which we can read in read-only mode ...
    const dbRead = new DB(TEST_DB, { mode: "read" });
    const rows = [...dbRead.query("SELECT id, name FROM test")];
    assertEquals(rows, [[1, "open-options-test"]]);

    // ... but we can't write with a read-only connection
    assertThrows(() =>
      dbRead.query("INTERT INTO test (name) VALUES (?)", ["this-fails"])
    );
    dbRead.close();
  },
);

Deno.test(
  "create / write mode require write permissions",
  {
    ignore: !TEST_DB_PERMISSIONS,
    permissions: { read: true, write: false },
    sanitizeResources: true,
  },
  function () {
    // opening with these modes requires write permissions ...
    assertThrows(() => new DB(TEST_DB, { mode: "create" }));
    assertThrows(() => new DB(TEST_DB, { mode: "write" }));

    // ... and the default mode is create
    assertThrows(() => new DB(TEST_DB));

    // however, opening in read-only mode should work (the file was created
    // in the previous test)
    (new DB(TEST_DB, { mode: "read" })).close();

    // with memory flag set, the database will be in memory and
    // not require any permissions
    (new DB(TEST_DB, { mode: "create", memory: true })).close();

    // the mode can also be specified via a URI flag
    (new DB(`file:${TEST_DB}?mode=memory`, { uri: true })).close();
  },
);

Deno.test(
  "database larger than 2GB read / write",
  {
    ignore: !LARGE_TEST_DB_PERMISSIONS,
    permissions: { read: true, write: true },
    sanitizeResources: true,
  },
  function () {
    // generated with `cd build && make testdb`
    const db = new DB(LARGE_TEST_DB, { mode: "write" });

    db.query("INSERT INTO test (value) VALUES (?)", ["This is a test..."]);

    const rows = [
      ...db.query("SELECT value FROM test ORDER BY id DESC LIMIT 10"),
    ];
    assertEquals(rows.length, 10);
    assertEquals(rows[0][0], "This is a test...");

    db.close();
  },
);
