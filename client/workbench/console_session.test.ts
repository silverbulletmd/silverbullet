import { expect, test } from "vitest";
import {
  LuaEnv,
  LuaNativeJSFunction,
  LuaRuntimeError,
} from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";
import { ConsoleLog, type LogEntry } from "./console_log.ts";
import {
  ConsoleSession,
  isExpressionInput,
  isIncompleteInput,
} from "./console_session.ts";

// The first value or argument an entry carries, whatever its kind
function value(e: LogEntry): unknown {
  switch (e.kind) {
    case "input":
      return e.code;
    case "result":
      return e.values[0];
    case "message":
      return e.args[0];
    case "stopped":
      return undefined;
  }
}

function setup(busyLimitMs?: number) {
  let spaceEnv = new LuaEnv(luaBuildStandardEnv());
  spaceEnv.setLocal("greeting", "hi");
  const log = new ConsoleLog();
  const toasts: any[] = [];
  const session = new ConsoleSession({
    spaceEnv: () => spaceEnv,
    log,
    ui: () => ({
      flashNotification: (m, _t, o) => {
        toasts.push({ m, o });
      },
    }),
    busyLimitMs,
  });
  return { session, log, toasts, swapSpaceEnv: (e: LuaEnv) => (spaceEnv = e) };
}

test("an expression logs input then its value", async () => {
  const { session, log } = setup();
  await session.run("1 + 2");
  expect(log.entries.map((e) => [e.kind, value(e)])).toEqual([
    ["input", "1 + 2"],
    ["result", 3],
  ]);
});

test("inputs submitted while one is still running wait for it", async () => {
  const { session, log } = setup();
  // `slow` resolves on a later macrotask, like a query would
  session
    .env()
    .setLocal(
      "slow",
      new LuaNativeJSFunction(
        () => new Promise((resolve) => setTimeout(() => resolve(21), 10)),
      ),
    );
  const first = session.run("local n = slow()");
  const second = session.run("n * 2");
  await Promise.all([first, second]);
  expect(value(log.entries.at(-1)!)).toBe(42);
});

test("a top-level local persists across runs", async () => {
  const { session, log } = setup();
  await session.run("local n = 21");
  await session.run("n * 2");
  expect(value(log.entries.at(-1)!)).toBe(42);
  expect(session.localNames()).toEqual(["n"]);
});

test("a block's return values are logged", async () => {
  const { session, log } = setup();
  await session.run("local a = 1\nreturn a, a + 1");
  expect(log.entries.at(-1)).toMatchObject({ kind: "result", values: [1, 2] });
});

test("errors are logged with a console ref and source kept", async () => {
  const { session, log } = setup();
  await session.run("local t = nil\nreturn t.x");
  const last = log.entries.at(-1)!;
  expect(last).toMatchObject({ kind: "message", level: "error" });
  const err = value(last) as LuaRuntimeError;
  expect(err).toBeInstanceOf(LuaRuntimeError);
  expect(err.sf.astCtx?.ref).toBe("console#1");
  expect(session.sourceFor("console#1")).toBe("local t = nil\nreturn t.x");
});

test("locals survive a space env reload and globals follow it", async () => {
  const { session, log, swapSpaceEnv } = setup();
  await session.run("local n = 5");
  const next = new LuaEnv(luaBuildStandardEnv());
  next.setLocal("greeting", "hello");
  swapSpaceEnv(next);
  await session.run("greeting .. n");
  expect(value(log.entries.at(-1)!)).toBe("hello5");
});

test("a runaway loop offers stop and logs a stopped row", async () => {
  const { session, log, toasts } = setup(50);
  const running = session.run("while true do end");
  await new Promise((r) => setTimeout(r, 200));
  expect(toasts).toHaveLength(1);
  toasts[0].o.actions.find((a: any) => a.name === "Stop").run();
  await running;
  expect(log.entries.at(-1)).toMatchObject({ kind: "stopped" });
});

test.each([
  ["function f()", true],
  ["local t = {", true],
  ["if x then", true],
  ["local x = = 2", false],
  ["1 + 2", false],
  ["nil_thing.x", false],
  ["x.y.z", false],
  ["", false],
])("isIncompleteInput(%j) is %s", (code, expected) => {
  expect(isIncompleteInput(code)).toBe(expected);
});

test("multiple expressions log every value", async () => {
  const { session, log } = setup();
  await session.run("1, 2");
  expect(log.entries.at(-1)).toMatchObject({ kind: "result", values: [1, 2] });
});

test("a trailing comment is ignored", async () => {
  const { session, log } = setup();
  await session.run("1 -- hi");
  expect(log.entries.at(-1)).toMatchObject({ kind: "result", values: [1] });
});

test("a nil expression still logs a result row", async () => {
  const { session, log } = setup();
  await session.run("nil");
  expect(log.entries.at(-1)).toMatchObject({ kind: "result" });
});

test("expression errors carry the console ref and in-bounds offsets", async () => {
  const { session, log } = setup();
  await session.run("nil_value.x");
  const err = value(log.entries.at(-1)!) as LuaRuntimeError;
  expect(err).toBeInstanceOf(LuaRuntimeError);
  expect(err.sf.astCtx?.ref).toBe("console#1");
  expect([err.sf.astCtx?.from, err.sf.astCtx?.to]).toEqual([0, 11]);
});

test("syntax errors carry the console ref", async () => {
  const { session, log } = setup();
  await session.run("x = = 1");
  const err = value(log.entries.at(-1)!) as LuaRuntimeError;
  expect(err.sf.astCtx?.ref).toBe("console#1");
  expect(err.sf.astCtx?.from).toBe(4);
});

test("closures follow a space env reload and see updated locals", async () => {
  const { session, log, swapSpaceEnv } = setup();
  await session.run("local n = 1");
  await session.run("local function f() return greeting .. n end");
  const next = new LuaEnv(luaBuildStandardEnv());
  next.setLocal("greeting", "new");
  swapSpaceEnv(next);
  await session.run("n = 2");
  await session.run("f()");
  expect(log.entries.at(-1)).toMatchObject({
    kind: "result",
    values: ["new2"],
  });
});

test("a const local stays const across a space env reload", async () => {
  const { session, log, swapSpaceEnv } = setup();
  await session.run("local c <const> = 1");
  swapSpaceEnv(new LuaEnv(luaBuildStandardEnv()));
  await session.run("c = 5");
  expect(log.entries.at(-1)).toMatchObject({ level: "error" });
  await session.run("c");
  expect(log.entries.at(-1)).toMatchObject({ kind: "result", values: [1] });
});

test.each([
  ["1 + 2", true],
  ['query[[from index.tag "task"]]', true],
  ["nil_thing.x -- note", true],
  ["local n = 1", false],
  ["1, 2", false],
  ["x = 1", false],
  ["", false],
])("isExpressionInput(%j) is %s", (code, expected) => {
  expect(isExpressionInput(code)).toBe(expected);
});
