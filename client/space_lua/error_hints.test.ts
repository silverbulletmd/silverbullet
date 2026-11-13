import { expect, test } from "vitest";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import { ArrayQueryCollection } from "./query_collection.ts";
import { LuaEnv, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

function parseError(code: string): string {
  try {
    parseBlock(code);
  } catch (e: any) {
    return e.message;
  }
  throw new Error(`expected a parse error for: ${code}`);
}

async function runError(code: string): Promise<string> {
  const global = luaBuildStandardEnv();
  const env = new LuaEnv(global);
  env.set(
    "rows",
    new ArrayQueryCollection([
      { name: "Incidents/Outage", tags: ["incident"] },
      { name: "Other", tags: [] },
    ]),
  );
  const block = parseBlock(code);
  try {
    await evalStatement(
      block,
      env,
      LuaStackFrame.createWithGlobalEnv(global, block.ctx),
    );
  } catch (e: any) {
    return e.message;
  }
  throw new Error(`expected a runtime error for: ${code}`);
}

// `sb query` wraps its argument like this.
const q = (sliq: string) => `return query[[${sliq}]]`;

test("a single = in a query's where clause suggests ==", () => {
  expect(
    parseError(
      q(
        `from p = index.pages() where p.name = "NPCs/Corwen" or p.name = "Items/Bell" select p.name`,
      ),
    ),
  ).toBe("unexpected symbol near '='; hint: use == to compare");
});

test("no hint outside a comparison context", () => {
  expect(parseError(`local x = = 1`)).toBe("unexpected symbol near '='");
  expect(parseError(q(`from p = rows select p.name = 1`))).toBe(
    "unexpected symbol near '='",
  );
  expect(
    parseError(q(`from p = rows select {name: p.name, rating: p.rating}`)),
  ).not.toContain("use ==");
});

test("calling an undefined global in a query names the from binding", async () => {
  expect(
    await runError(
      q(`from p = rows where s:startsWith(p.name, "Incidents/") select p.name`),
    ),
  ).toBe(
    "attempt to index a nil value (global 's'); hint: 's' is not defined; this query binds each row to 'p' (from p = ...)",
  );
});

test("no query hint outside a query", async () => {
  expect(await runError(`return s:startsWith("x")`)).toBe(
    "attempt to index a nil value (global 's')",
  );
});

// ---------------------------------------------------------------------------
// Hints for further failures mined from skill-eval logs. Queries are real ones
// from the logs, with `index.*()` swapped for the in-memory `rows` collection
// only where the query has to run.

async function runValue(code: string): Promise<any> {
  const global = luaBuildStandardEnv();
  const env = new LuaEnv(global);
  const block = parseBlock(code);
  const r: any = await evalStatement(
    block,
    env,
    LuaStackFrame.createWithGlobalEnv(global, block.ctx),
  );
  return r?.values?.[0];
}

test("a missing string method is named, with a substring hint", async () => {
  expect(
    await runError(
      q(
        `from p = rows where p.name:contains("Candidate") limit 20 select p.name`,
      ),
    ),
  ).toBe(
    `attempt to call a nil value (method 'contains'); hint: strings have no 'contains' method; use s:find("x", 1, true) to test for a substring, or s:startsWith("x") / s:endsWith("x")`,
  );
});

test("an unknown string method lists the string library", async () => {
  expect(await runError(`return ("Books/Piranesi"):basename()`)).toBe(
    "attempt to call a nil value (method 'basename'); hint: strings have no 'basename' method; string methods include find, match, gmatch, gsub, sub, split, startsWith, endsWith, trim, lower and upper",
  );
});

test("a missing table method suggests table.includes", async () => {
  expect(
    await runError(`local tags = {"npc"}\nreturn tags:contains("npc")`),
  ).toBe(
    "attempt to call a nil value (method 'contains'); hint: tables have no 'contains' method; use table.includes(t, value)",
  );
});

test("a missing method on an indexed list suggests table.includes", async () => {
  // Index rows carry plain JS arrays, which used to fail with "attempt to
  // index a table value".
  expect(
    await runError(
      q(
        `from p = rows where p.tags:contains("npc") and p.status == "alive" select p.name`,
      ),
    ),
  ).toBe(
    "attempt to call a nil value (method 'contains'); hint: tables have no 'contains' method; use table.includes(t, value)",
  );
});

test("calling a missing field names the field", async () => {
  expect(
    await runError(`ops = {}\nreturn ops.blastRadius("Services/Orders DB")`),
  ).toBe("attempt to call a nil value (field 'blastRadius')");
});

test("indexing an undefined global names it", async () => {
  expect(
    await runError(
      `return incidentHistory.forService("Services/Notifications")`,
    ),
  ).toBe("attempt to index a nil value (global 'incidentHistory')");
});

test("indexing a nil local names it as local", async () => {
  expect(await runError(`local t = nil\nreturn t[1]`)).toBe(
    "attempt to index a nil value (local 't')",
  );
});

test("a method call on a nil `.s` field explains the s: notation", async () => {
  expect(
    await runError(
      q(
        `from p = rows where p.name.s:startsWith("Sessions/") select p.name limit 2`,
      ),
    ),
  ).toBe(
    `attempt to index a nil value (field 's'); hint: in s:startsWith("x"), 's' stands for the string itself; write p.name:startsWith(...)`,
  );
});

test("a method call on a multi-value result uses the first value", async () => {
  expect(
    await runValue(
      `return ("Piranesi & Co"):gsub("&", "&amp;"):gsub("<", "&lt;")`,
    ),
  ).toBe("Piranesi &amp; Co");
});

test("indexing a query result suggests parentheses", () => {
  expect(
    parseError(
      `return query[[from p = index.pages("meta/template/page") where p.name == "Library/Page Templates/Session" select p]][1]`,
    ),
  ).toBe(
    "unexpected symbol near '['; hint: wrap the query in parentheses to index it: (query[[...]])[1]",
  );
});

test("a statement passed as an expression points at scripts", () => {
  // `sb eval` wraps its argument like this.
  const ev = (expr: string) => `return ${expr}`;
  expect(parseError(ev(`return #ops.services()`))).toBe(
    "unexpected symbol near 'r'; hint: an expression is expected here and is returned already; drop the 'return', or run statements as a script instead",
  );
  expect(
    parseError(
      ev(
        `local x=ops.incidentsFor("Services/Checkout API"); return x[1].date .. " " .. x[1].severity`,
      ),
    ),
  ).toBe(
    "unexpected symbol near 'l'; hint: an expression is expected here, but 'local' starts a statement; run statements as a script instead",
  );
});

test("x:s:method explains the s: notation", () => {
  expect(
    parseError(
      q(
        `from t = index.tasks() where not t.done and not t.page:s:startsWith("Library/") group by t.page select {page=key, open=#group} order by page`,
      ),
    ),
  ).toBe(
    `unexpected symbol near ':'; hint: in s:startsWith("x"), 's' stands for the string itself; write t.page:startsWith(...)`,
  );
});

test("hint look-alikes inside string literals and comments add no hint", () => {
  for (const code of [
    `local s = "{name: p.name}" x`,
    `local s = "where p.name like x" y`,
    `-- {page: t.page}\nlocal x = = 1`,
    `local s = "query(" y`,
  ]) {
    expect(parseError(code)).not.toContain("hint");
  }
});

test("defining a function on a nil table says to create the table first", async () => {
  const hint = `hint: create the table first (A = A or {}). Space Lua blocks load in priority order; add "-- priority: N" to the block that creates it if it lives elsewhere`;
  expect(await runError(`function A.b() end`)).toBe(
    `cannot define function A.b: 'A' is nil; ${hint}`,
  );
  expect(await runError(`function A:m() end`)).toBe(
    `cannot define function A:m: 'A' is nil; ${hint}`,
  );
  expect(await runError(`local E = nil\nfunction E.x() end`)).toBe(
    `cannot define function E.x: 'E' is nil; hint: create the table first (E = E or {}). Space Lua blocks load in priority order; add "-- priority: N" to the block that creates it if it lives elsewhere`,
  );
  expect(await runError(`A = {}\nfunction A.b.c() end`)).toBe(
    `cannot define function A.b.c: 'A.b' is nil; hint: create the table first (A.b = A.b or {}). Space Lua blocks load in priority order; add "-- priority: N" to the block that creates it if it lives elsewhere`,
  );
});
