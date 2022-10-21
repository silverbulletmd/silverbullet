import { AsyncSQLite } from "./async_sqlite.ts";
import { assertEquals } from "../../test_deps.ts";

Deno.test("Async SQLite test", async () => {
  const db = new AsyncSQLite(":memory:");
  await db.init();
  await db.execute("CREATE TABLE test (name TEXT)");
  await db.execute("INSERT INTO test (name) VALUES (?)", "test");
  await db.execute("INSERT INTO test (name) VALUES (?)", "test 2");
  assertEquals(await db.query("SELECT * FROM test ORDER BY name"), [{
    name: "test",
  }, {
    name: "test 2",
  }]);
  db.stop();
});
