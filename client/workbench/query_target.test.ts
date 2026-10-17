import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { QueryBuilder } from "./query_builder.ts";
import { followEdits, insertRange } from "./query_target.ts";

describe("followEdits", () => {
  test("moves the target with text inserted before it", () => {
    const builder = new QueryBuilder();
    builder.setTarget({ page: "Dashboard", from: 7, to: 7 });
    const state = EditorState.create({ doc: "Before\n" });
    const tr = state.update({ changes: { from: 0, insert: "Top\n" } });
    followEdits(builder, { docChanged: true, changes: tr.changes });
    expect(builder.target).toEqual({ page: "Dashboard", from: 11, to: 11 });
  });

  test("leaves the target alone for text after it", () => {
    const builder = new QueryBuilder();
    builder.setTarget({ page: "Dashboard", from: 3, to: 3 });
    const state = EditorState.create({ doc: "Before\n" });
    const tr = state.update({ changes: { from: 7, insert: "After" } });
    followEdits(builder, { docChanged: true, changes: tr.changes });
    expect(builder.target?.from).toBe(3);
  });

  test("a query being replaced keeps its span as text is typed inside it", () => {
    const builder = new QueryBuilder();
    builder.setTarget({ page: "Dashboard", from: 2, to: 12 });
    const state = EditorState.create({ doc: "a ${query[[]]} b" });
    const tr = state.update({ changes: { from: 0, insert: "xx" } });
    followEdits(builder, { docChanged: true, changes: tr.changes });
    const inside = tr.state.update({ changes: { from: 10, insert: "y" } });
    followEdits(builder, { docChanged: true, changes: inside.changes });
    expect(builder.target).toEqual({ page: "Dashboard", from: 4, to: 15 });
  });
});

describe("insertRange", () => {
  const target = { page: "Dashboard", from: 40, to: 60 };

  test("the target, when its page is open", () => {
    expect(insertRange(target, "Dashboard", 100, 5)).toEqual({
      from: 40,
      to: 60,
      elsewhere: false,
    });
  });

  test("never past the end of the page", () => {
    expect(insertRange(target, "Dashboard", 50, 5)).toEqual({
      from: 40,
      to: 50,
      elsewhere: false,
    });
  });

  test("the cursor, when another page is open", () => {
    expect(insertRange(target, "Inbox", 100, 5)).toEqual({
      from: 5,
      to: 5,
      elsewhere: true,
    });
  });

  test("the cursor, without a target", () => {
    expect(insertRange(null, "Inbox", 100, 5)).toEqual({
      from: 5,
      to: 5,
      elsewhere: false,
    });
  });
});
