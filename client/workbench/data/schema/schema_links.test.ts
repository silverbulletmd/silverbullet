import { expect, test } from "vitest";
import { objectsFilter } from "./schema_links.ts";

test("a missing value is the attribute's 'doesn't exist' filter", () => {
  expect(objectsFilter({ kind: "missing", attribute: "owner" }, "p")).toEqual({
    kind: "attribute",
    attribute: "owner",
    op: "missing",
    values: [],
  });
});

test("a value is the attribute's 'is' filter", () => {
  expect(
    objectsFilter({ kind: "value", attribute: "status", value: "active" }, "p"),
  ).toEqual({
    kind: "attribute",
    attribute: "status",
    op: "is",
    values: ["active"],
  });
});

test("invalid values validate the attribute against its schema", () => {
  expect(
    objectsFilter(
      {
        kind: "invalid",
        attribute: "status",
        schema: { type: "string", enum: ["a", "b"] },
      },
      "p",
    ),
  ).toEqual({
    kind: "expr",
    expr: 'p.status ~= nil and jsonschema.validateObject({type = "object", properties = {status = schema.enum {"a", "b"}}}, {status = p.status}) ~= nil',
  });
});

test("attribute names that aren't Lua names are indexed", () => {
  const f = objectsFilter(
    { kind: "invalid", attribute: "due-date", schema: { type: "string" } },
    "_",
  );
  expect(f.kind === "expr" && f.expr).toContain('_["due-date"] ~= nil');
  expect(f.kind === "expr" && f.expr).toContain(
    '{["due-date"] = _["due-date"]}',
  );
});
