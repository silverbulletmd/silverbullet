import { expect, test } from "vitest";
import type { LogEntry } from "./console_log.ts";
import { filterEntries } from "./log_filter.ts";

type Message = Extract<LogEntry, { kind: "message" }>;

const e = (over: Partial<Message>): LogEntry => ({
  kind: "message",
  id: 1,
  time: 0,
  level: "log",
  source: "js",
  args: [],
  ...over,
});

const entries = [
  e({ id: 1, source: "lua", args: ["hello lua"] }),
  e({ id: 2, source: "js", args: ["indexed 3 pages"] }),
  e({ id: 3, source: "js", level: "error", args: [new Error("boom")] }),
  e({ id: 4, source: "js", level: "debug", args: ["noise"] }),
];

test("an empty filter keeps every entry", () => {
  expect(filterEntries(entries, " ").map((x) => x.id)).toEqual([1, 2, 3, 4]);
});

test("a source filter keeps only that source, errors keep every error", () => {
  expect(filterEntries(entries, "", "lua").map((x) => x.id)).toEqual([1]);
  expect(filterEntries(entries, "", "js").map((x) => x.id)).toEqual([2, 3, 4]);
  expect(filterEntries(entries, "", "error").map((x) => x.id)).toEqual([3]);
  expect(filterEntries(entries, "", "all").map((x) => x.id)).toEqual([
    1, 2, 3, 4,
  ]);
});

test("source and text filters combine", () => {
  expect(filterEntries(entries, "pages", "js").map((x) => x.id)).toEqual([2]);
  expect(filterEntries(entries, "pages", "lua")).toEqual([]);
});

test("text filter matches previews case-insensitively", () => {
  expect(filterEntries(entries, "BOOM").map((x) => x.id)).toEqual([3]);
});

test("plug and service worker lines filter by source; a plug's name matches text", () => {
  const workers = [
    e({ id: 7, source: "plug", scope: "index", args: ["Indexed page"] }),
    e({ id: 8, source: "sw", args: ["Sync complete"] }),
  ];
  expect(filterEntries(workers, "", "plug").map((x) => x.id)).toEqual([7]);
  expect(filterEntries(workers, "", "sw").map((x) => x.id)).toEqual([8]);
  expect(filterEntries(workers, "index").map((x) => x.id)).toEqual([7]);
});

test("console input and results count as Lua", () => {
  const console = [
    { kind: "input", ref: "console#1", code: "1 + 2", id: 5, time: 0 },
    { kind: "result", values: [3], id: 6, time: 0 },
  ] satisfies LogEntry[];
  expect(filterEntries(console, "", "lua").map((x) => x.id)).toEqual([5, 6]);
  expect(filterEntries(console, "1 + 2").map((x) => x.id)).toEqual([5]);
});

test("entry text is computed once per entry", () => {
  let reads = 0;
  const arg = {
    get name() {
      reads++;
      return "counted";
    },
  };
  const entry = e({ id: 9, args: [arg] });
  expect(filterEntries([entry], "counted")).toEqual([entry]);
  const afterFirst = reads;
  expect(afterFirst).toBeGreaterThan(0);
  expect(filterEntries([entry], "count")).toEqual([entry]);
  expect(reads).toBe(afterFirst);
});
