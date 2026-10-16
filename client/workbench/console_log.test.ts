import { expect, test, vi } from "vitest";
import { emitRuntimeLog, setRuntimeLogSink } from "../lib/runtime_log.ts";
import { ConsoleLog, type LogEntry } from "./console_log.ts";

// Every entry these tests make is a message
const args = (e: LogEntry) => (e.kind === "message" ? e.args : []);

function fakeTarget() {
  const calls: any[][] = [];
  const listeners: Record<string, (e: any) => void> = {};
  const c: any = {};
  for (const l of ["log", "info", "warn", "error", "debug"]) {
    c[l] = (...a: any[]) => calls.push([l, ...a]);
  }
  return {
    calls,
    listeners,
    target: {
      console: c as Console,
      addEventListener: ((t: string, fn: any) => (listeners[t] = fn)) as any,
    },
  };
}

test("caps the buffer, dropping the oldest entries", () => {
  const log = new ConsoleLog(3);
  for (let i = 0; i < 5; i++) log.message("log", "js", [i]);
  expect(log.entries.map((e) => args(e)[0])).toEqual([2, 3, 4]);
});

test("wrapped console methods record and still call the original", () => {
  const { calls, target } = fakeTarget();
  const log = new ConsoleLog();
  log.install(target);
  target.console.warn("careful", 1);
  expect(calls).toEqual([["warn", "careful", 1]]);
  expect(log.entries[0]).toMatchObject({
    level: "warn",
    source: "js",
    args: ["careful", 1],
  });
});

test("records window errors and unhandled rejections", () => {
  const { listeners, target } = fakeTarget();
  const log = new ConsoleLog();
  log.install(target);
  const boom = new Error("boom");
  listeners.error({ error: boom, message: "boom" });
  listeners.unhandledrejection({ reason: "nope" });
  expect(
    log.entries.map((e) => [e.kind === "message" && e.level, args(e)[0]]),
  ).toEqual([
    ["error", boom],
    ["error", "nope"],
  ]);
});

test("Lua print is recorded exactly once, as lua", () => {
  const { calls, target } = fakeTarget();
  const log = new ConsoleLog();
  log.install(target);
  emitRuntimeLog({
    source: "lua",
    level: "log",
    text: "hi",
    origin: { ref: "Sample@0", from: 4 },
  });
  expect(log.entries).toHaveLength(1);
  expect(log.entries[0]).toMatchObject({
    source: "lua",
    args: ["hi"],
    origin: { ref: "Sample@0", from: 4 },
  });
  expect(calls).toEqual([["log", "[Lua]", "hi"]]);
  setRuntimeLogSink(null);
});

test("a subscriber that logs doesn't re-record or re-notify", () => {
  const { calls, target } = fakeTarget();
  const log = new ConsoleLog();
  log.install(target);
  const seen = vi.fn(() => target.console.log("render"));
  log.subscribe(seen);
  target.console.log("first");
  expect(log.entries.map((e) => args(e)[0])).toEqual(["first"]);
  expect(seen).toHaveBeenCalledTimes(1);
  expect(calls).toContainEqual(["log", "render"]);
});

test("a throwing subscriber doesn't break logging or skip other subscribers", () => {
  const { calls, target } = fakeTarget();
  const log = new ConsoleLog();
  log.install(target);
  log.subscribe(() => {
    throw new Error("render failed");
  });
  const second = vi.fn();
  log.subscribe(second);
  expect(() => target.console.log("still works")).not.toThrow();
  expect(calls).toContainEqual(["log", "still works"]);
  expect(log.entries.map((e) => args(e)[0])).toEqual(["still works"]);
  expect(second).toHaveBeenCalledTimes(1);
  expect(calls.some((c) => c[0] === "error")).toBe(true);
});

test("an unhandled rejection already reported via console.error is not logged again", () => {
  const { listeners, target } = fakeTarget();
  const log = new ConsoleLog();
  log.install(target);
  const reason = new Error("rejected");
  target.console.error("Error during :", reason);
  listeners.unhandledrejection({ reason });
  expect(log.entries.map((e) => args(e))).toEqual([["Error during :", reason]]);
});

test("a rejection recorded first still lets the later console.error record", () => {
  const { listeners, target } = fakeTarget();
  const log = new ConsoleLog();
  log.install(target);
  const reason = new Error("rejected");
  listeners.unhandledrejection({ reason });
  target.console.error("Error during :", reason);
  expect(log.entries.map((e) => args(e))).toEqual([
    [reason],
    ["Error during :", reason],
  ]);
});

test("rejection dedupe only looks at the last 20 entries", () => {
  const { listeners, target } = fakeTarget();
  const log = new ConsoleLog();
  log.install(target);
  const reason = new Error("rejected");
  target.console.error(reason);
  for (let i = 0; i < 20; i++) target.console.log(i);
  listeners.unhandledrejection({ reason });
  expect(args(log.entries.at(-1)!)).toEqual([reason]);
  expect(log.entries).toHaveLength(22);
});

test("plug lines keep the plug's name; neither is echoed to the console", () => {
  const { calls, target } = fakeTarget();
  const log = new ConsoleLog();
  log.install(target);
  emitRuntimeLog({
    source: "plug",
    scope: "index",
    level: "warn",
    text: "slow",
  });
  expect(log.entries[0]).toMatchObject({
    kind: "message",
    source: "plug",
    scope: "index",
    level: "warn",
    args: ["slow"],
  });
  expect(calls).toEqual([]);
  setRuntimeLogSink(null);
});

test("service worker log lines arrive as sw messages; other messages are ignored", () => {
  const swListeners: ((e: any) => void)[] = [];
  const { target } = fakeTarget();
  const log = new ConsoleLog();
  log.install({
    ...target,
    serviceWorker: {
      addEventListener: ((_: string, fn: any) => swListeners.push(fn)) as any,
    },
  });
  for (const fn of swListeners) {
    fn({ data: { type: "sync-conflict", path: "a.md" } });
    fn({
      data: {
        type: "log",
        entry: { level: "info", timestamp: 0, message: "Synced 3 files" },
      },
    });
  }
  expect(log.entries).toMatchObject([
    { kind: "message", source: "sw", level: "info", args: ["Synced 3 files"] },
  ]);
  setRuntimeLogSink(null);
});
