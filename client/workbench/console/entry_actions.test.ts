import { expect, test, vi } from "vitest";
import { LuaRuntimeError, LuaStackFrame } from "../../space_lua/runtime.ts";
import type { LogEntry, LogRecord } from "./console_log.ts";
import { type ActionDeps, entryActions } from "./entry_actions.ts";

const e = (record: LogRecord): LogEntry => ({ ...record, id: 1, time: 0 });

const labels = (entry: LogEntry) => entryActions(entry).map((a) => a.label);

function fakeDeps() {
  return {
    copyText: vi.fn(async (_: string) => {}),
    copyValue: vi.fn(async (_: unknown) => {}),
    rerun: vi.fn(async (_: string) => {}),
  } satisfies ActionDeps;
}

async function runAction(entry: LogEntry, label: string) {
  const deps = fakeDeps();
  await entryActions(entry)
    .find((a) => a.label === label)!
    .run(deps);
  return deps;
}

test("an expression input offers copy as ${…}", async () => {
  const input = e({ kind: "input", ref: "console#1", code: "1 + 2" });
  expect(labels(input)).toEqual(["Copy as ${…}", "Copy code", "Run again"]);
  const deps = await runAction(input, "Copy as ${…}");
  expect(deps.copyText).toHaveBeenCalledWith("${1 + 2}");
});

test("a statement input has no ${…} form and runs again", async () => {
  const input = e({ kind: "input", ref: "console#1", code: "local n = 1" });
  expect(labels(input)).toEqual(["Copy code", "Run again"]);
  const deps = await runAction(input, "Run again");
  expect(deps.rerun).toHaveBeenCalledWith("local n = 1");
});

test("a single result copies as markdown", async () => {
  const value = { a: 1 };
  const result = e({ kind: "result", values: [value] });
  expect(labels(result)).toEqual(["Copy as Markdown"]);
  const deps = await runAction(result, "Copy as Markdown");
  expect(deps.copyValue).toHaveBeenCalledWith(value);
});

test("multiple results or none have nothing to copy as one value", () => {
  expect(labels(e({ kind: "result", values: [1, 2] }))).toEqual([]);
  expect(labels(e({ kind: "result", values: [] }))).toEqual([]);
});

test("errors copy their message", async () => {
  const err = new LuaRuntimeError("boom", LuaStackFrame.lostFrame);
  const entry = e({
    kind: "message",
    level: "error",
    source: "lua",
    args: ["Context:", err],
  });
  expect(labels(entry)).toEqual(["Copy error"]);
  const deps = await runAction(entry, "Copy error");
  expect(deps.copyText).toHaveBeenCalledWith("Context: boom");
});

test("other entries copy their text", async () => {
  const entry = e({
    kind: "message",
    level: "log",
    source: "js",
    args: ["Indexed", 3, "pages"],
  });
  expect(labels(entry)).toEqual(["Copy text"]);
  const deps = await runAction(entry, "Copy text");
  expect(deps.copyText).toHaveBeenCalledWith("Indexed 3 pages");
});

test("stopped rows have no actions", () => {
  expect(labels(e({ kind: "stopped" }))).toEqual([]);
});
