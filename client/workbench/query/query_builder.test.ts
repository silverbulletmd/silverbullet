import { describe, expect, test, vi } from "vitest";
import { QueryBuilder } from "./query_builder.ts";
import { inferFields } from "./query_fields.ts";
import { sourceFor } from "./query_from.ts";

const taskFields = inferFields(
  [{ name: "Send report", done: false }],
  null,
  false,
);
const pageFields = inferFields([{ name: "Dashboard" }], null, false);

describe("QueryBuilder", () => {
  test("starts empty and picks a tag", () => {
    const b = new QueryBuilder();
    expect(b.model).toBe(null);
    b.pickSource(sourceFor("task"), taskFields);
    expect(b.model?.source).toEqual(sourceFor("task"));
    expect(b.fields).toBe(taskFields);
  });

  test("notifies subscribers on update until unsubscribed", () => {
    const b = new QueryBuilder();
    b.pickSource(sourceFor("task"), taskFields);
    const fn = vi.fn();
    const off = b.subscribe(fn);
    b.update((m) => ({ ...m, limit: 5 }));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(b.model?.limit).toBe(5);
    off();
    b.update((m) => ({ ...m, limit: 6 }));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("switching tag after edits can be undone", () => {
    const b = new QueryBuilder();
    b.pickSource(sourceFor("task"), taskFields);
    b.update((m) => ({
      ...m,
      filters: [{ kind: "expr", expr: "not t.done" }],
    }));
    expect(b.pickSource(sourceFor("page"), pageFields)).toBe(true);
    expect(b.model?.source).toEqual(sourceFor("page"));
    expect(b.undo()).toBe(true);
    expect(b.model?.source).toEqual(sourceFor("task"));
    expect(b.model?.filters).toHaveLength(1);
    expect(b.fields).toBe(taskFields);
  });

  test("switching tag without edits keeps no snapshot", () => {
    const b = new QueryBuilder();
    b.pickSource(sourceFor("task"), taskFields);
    expect(b.pickSource(sourceFor("page"), pageFields)).toBe(false);
    expect(b.undo()).toBe(false);
  });

  test("an update can be made undoable", () => {
    const b = new QueryBuilder();
    b.pickSource(sourceFor("task"), taskFields);
    b.update((m) => ({ ...m, limit: 5 }), { undoable: true });
    expect(b.undo()).toBe(true);
    expect(b.model?.limit).toBe(null);
  });

  test("keeps the insert target", () => {
    const b = new QueryBuilder();
    const fn = vi.fn();
    b.subscribe(fn);
    b.setTarget({ page: "Dashboard", from: 42, to: 42 });
    expect(b.target).toEqual({ page: "Dashboard", from: 42, to: 42 });
    expect(fn).toHaveBeenCalled();
  });
  test("opening a model replaces the current one, undoably", () => {
    const b = new QueryBuilder();
    b.pickSource(sourceFor("task"), taskFields);
    b.update((m) => ({ ...m, limit: 5 }));
    const resets = b.resets;
    const opened = { ...b.model!, source: sourceFor("page"), limit: 2 };
    b.openModel(opened, pageFields);
    expect(b.model).toBe(opened);
    expect(b.fields).toBe(pageFields);
    expect(b.resets).toBe(resets + 1);
    // Untouched since opening: picking another tag needs no undo
    expect(b.pickSource(sourceFor("task"), taskFields)).toBe(false);
    b.openModel(opened, pageFields);
    expect(b.undo()).toBe(true);
    expect(b.model?.source).toEqual(sourceFor("task"));
  });
  test("narrowing keeps the query, undoably", () => {
    const b = new QueryBuilder();
    b.pickSource(sourceFor("task"), taskFields);
    b.update((m) => ({ ...m, limit: 5 }));
    b.narrow({ root: "task", tag: "work", by: "root" }, taskFields);
    expect(b.model?.source).toEqual({ root: "task", tag: "work", by: "root" });
    expect(b.model?.limit).toBe(5);
    expect(b.undo()).toBe(true);
    expect(b.model?.source).toEqual(sourceFor("task"));
  });
  test("narrowing an untouched query rebuilds it for the new fields", () => {
    const b = new QueryBuilder();
    b.pickSource(sourceFor("task"), []);
    b.narrow({ root: "task", tag: "work", by: "root" }, taskFields);
    expect(
      b.model?.select.mode === "table" && b.model.select.columns.length,
    ).toBe(2);
  });
  test("the query editor shows until closed", () => {
    expect(new QueryBuilder().editing).toBe(true);
  });
  test("fresh data keeps the query, and rebuilds one not yet touched", () => {
    const b = new QueryBuilder();
    // Picked before anything was indexed: no fields, so no columns
    b.pickSource(sourceFor("task"), []);
    const version = b.dataVersion;
    b.refreshData(taskFields);
    expect(b.fields).toBe(taskFields);
    expect(b.dataVersion).toBe(version + 1);
    expect(
      b.model?.select.mode === "table" && b.model.select.columns.length,
    ).toBe(2);
    // Once edited, the query stays as it is
    b.update((m) => ({ ...m, limit: 5 }));
    const edited = b.model;
    b.refreshData(pageFields);
    expect(b.model).toBe(edited);
    expect(b.fields).toBe(pageFields);
  });

  test("fresh data with nothing picked does nothing", () => {
    const b = new QueryBuilder();
    b.refreshData(taskFields);
    expect(b.model).toBe(null);
    expect(b.fields).toEqual([]);
  });
});
