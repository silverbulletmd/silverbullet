import { expect, test } from "vitest";
import { schemaSources } from "./tag_sources.ts";

test("finds top-level tag.define calls that set a schema, by tag", () => {
  expect(
    schemaSources([
      {
        ref: "Books@10",
        page: "Books",
        script:
          'tag.define { name = "book", schema = { type = "object" } }\ntag.define { name = "series", tagPage = "Series" }',
      },
      {
        ref: "CONFIG@5",
        page: "CONFIG",
        script: 'tag.define { name = "book", schema = build() }',
      },
    ]),
  ).toEqual({
    book: [
      { ref: "Books@10", page: "Books" },
      { ref: "CONFIG@5", page: "CONFIG" },
    ],
  });
});

test("computed names, nested calls, the schemas block and invalid Lua are skipped", () => {
  expect(
    schemaSources([
      { ref: "A@1", page: "A", script: "tag.define { name = n, schema = {} }" },
      {
        ref: "B@1",
        page: "B",
        script: 'if x then tag.define { name = "b", schema = {} } end',
      },
      {
        ref: "CONFIG@9",
        page: "CONFIG",
        script:
          '-- managed-by: workbench-schemas\ntag.define { name = "c", schema = {} }',
      },
      { ref: "D@1", page: "D", script: "tag.define {" },
    ]),
  ).toEqual({});
});

test("without a page field, the page comes from the ref", () => {
  expect(
    schemaSources([
      {
        ref: "Library/Std/Infrastructure/Root Tags@106",
        page: undefined as unknown as string,
        script: 'tag.define { name = "page", schema = { type = "object" } }',
      },
    ]),
  ).toEqual({
    page: [
      {
        ref: "Library/Std/Infrastructure/Root Tags@106",
        page: "Library/Std/Infrastructure/Root Tags",
      },
    ],
  });
});
