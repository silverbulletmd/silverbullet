import { beforeEach, afterEach, expect, test } from "@jest/globals";
import { unlink } from "fs/promises";
import knex, { Knex } from "knex";
import { Authenticator } from "./auth";

let db: Knex<any, unknown[]> | undefined;

beforeEach(async () => {
  db = knex({
    client: "better-sqlite3",
    connection: {
      filename: "auth-test.db",
    },
    useNullAsDefault: true,
  });
});

afterEach(async () => {
  db!.destroy();
  await unlink("auth-test.db");
});

test("Test auth", async () => {
  let auth = new Authenticator(db!);
  await auth.ensureTables();
  await auth.createAccount("admin", "admin");
  expect(await auth.verify("admin", "admin")).toBe(true);
  expect(await auth.verify("admin", "sup")).toBe(false);
});
