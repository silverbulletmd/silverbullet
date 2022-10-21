/**
 * cli.ts
 *
 * A simple clone of the sqlite3 command line
 * interface, build using deno-sqlite.
 *
 * This is an example, meant to illustrate using
 * the API provided by deno-sqlite.
 */

import { readLines, writeAll } from "https://deno.land/std@0.134.0/io/mod.ts";
import AsciiTable from "https://deno.land/x/ascii_table@v0.1.0/mod.ts";
import { DB } from "../mod.ts";

const db = new DB(Deno.args[0] ?? undefined);

async function print(str: string) {
  const enc = new TextEncoder();
  await writeAll(Deno.stdout, enc.encode(str));
}

async function prompt() {
  await print("sqlite> ");
}

const tablesQuery = db.prepareQuery<[string]>(
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
);

const commands: Record<string, () => Promise<void>> = {
  "tables": async () => {
    for (const [name] of tablesQuery.iter()) {
      await print(`${name}\n`);
    }
  },
  "quit": async () => {
    await print("\n");
    Deno.exit(0);
  },
  "help": async () => {
    await print(
      "Type an SQL query or run a command.\nThe following commands are available:\n",
    );
    for (const key in commands) {
      await print(`.${key}\n`);
    }
  },
};

await prompt();
for await (const cmd of readLines(Deno.stdin)) {
  if (cmd[0] === ".") {
    const action = commands[cmd.slice(1)] ??
      (() => print("Unrecognized command, try .help\n"));
    await action();
  } else {
    try {
      const query = db.prepareQuery(cmd);
      const rows = query.all();
      const cols = query.columns();
      query.finalize();

      if (cols.length) {
        const table = new AsciiTable();
        table.setHeading("#", ...cols.map(({ name }) => name));
        for (const [idx, row] of rows.entries()) {
          table.addRow(idx + 1, ...row);
        }
        print(table.toString());
        print("\n");
      } else {
        print(`Executed query: ${db.changes} changes\n`);
      }
    } catch (err) {
      console.error(err);
    }
  }
  await prompt();
}
