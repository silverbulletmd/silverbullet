import { describe, expect, test } from "vitest";
import { inferAttributes } from "./query_attributes.ts";
import { sourceFor } from "./query_from.ts";
import { emptyModel } from "./query_model.ts";

describe("default columns", () => {
  const sample = (tag: string) => [
    { ref: "A", tag, name: "Projects/Alpha", status: "active" },
    { ref: "B", tag, name: "Projects/Beta", status: "done" },
  ];

  test("page objects show their name as a page link", () => {
    const attributes = inferAttributes(sample("page"), null, false);
    const name = emptyModel(sourceFor("project"), attributes).select;
    expect(name.mode === "table" && name.columns[0]).toMatchObject({
      header: "name",
      kind: "link",
      value: "name",
    });
  });

  test("other objects keep a plain name column", () => {
    const attributes = inferAttributes(sample("task"), null, false);
    const m = emptyModel(sourceFor("task"), attributes).select;
    expect(m.mode === "table" && m.columns[0]).toMatchObject({
      kind: "attribute",
      value: "name",
    });
  });
});
