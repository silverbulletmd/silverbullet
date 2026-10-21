import { describe, expect, test } from "vitest";
import {
  declaredFieldsFromSchema,
  effectiveType,
  type FieldInfo,
  inferFields,
  tagDefineSnippet,
  valueType,
} from "./query_fields.ts";

const books = [
  {
    title: "The Left Hand of Darkness",
    status: "finished",
    rating: 5,
    year: 1969,
    genre: "sci-fi",
  },
  {
    title: "Piranesi",
    status: "finished",
    rating: 4,
    year: 2020,
    genre: "fantasy",
  },
  { title: "The Dispossessed", status: "reading", year: 1974, genre: "sci-fi" },
  {
    title: "Project Hail Mary",
    status: "finished",
    rating: 4,
    year: 2021,
    genre: "sci-fi",
  },
  { title: "Braiding Sweetgrass", status: "want", year: 2013, genre: "nature" },
  { title: "The Overstory", status: "reading", year: 2018, genre: "fiction" },
  {
    title: "A Psalm for the Wild-Built",
    status: "finished",
    rating: "loved it",
    year: 2021,
    genre: "mystery",
  },
  {
    title: "Thinking in Systems",
    status: "want",
    year: 2008,
    genre: "nonfiction",
  },
  {
    title: "Klara and the Sun",
    status: "finished",
    rating: 3,
    year: 2021,
    genre: "fiction",
  },
  {
    title: "The Name of the Rose",
    status: "want",
    year: 1980,
    genre: "history",
  },
];

const byName = (fields: FieldInfo[], name: string) =>
  fields.find((f) => f.name === name)!;

describe("valueType", () => {
  test("recognizes basic types and text formats", () => {
    expect(valueType("2026-10-21")).toBe("date");
    expect(valueType("2026-10-16T08:12:00")).toBe("datetime");
    expect(valueType("[[People/Sam Ortiz]]")).toBe("pagelink");
    expect(valueType("https://example.com")).toBe("url");
    expect(valueType("plain")).toBe("text");
    expect(valueType(5)).toBe("number");
    expect(valueType(true)).toBe("boolean");
    expect(valueType(["a"])).toBe("list");
    expect(valueType({ a: 1 })).toBe("record");
    expect(valueType(null)).toBe(null);
    expect(valueType(undefined)).toBe(null);
  });
});

describe("inferFields", () => {
  const fields = inferFields(books, null, false);

  test("a field with few repeating values is one of", () => {
    const status = byName(fields, "status");
    expect(status.type).toBe("enum");
    expect([...status.enumValues!].sort()).toEqual([
      "finished",
      "reading",
      "want",
    ]);
  });

  test("a field whose repeated values cover under 80% stays text", () => {
    expect(byName(fields, "genre").type).toBe("text");
  });

  test("values of several types are mixed, falling back to text", () => {
    const rating = byName(fields, "rating");
    expect(rating.type).toBe("mixed");
    expect(rating.mixed).toEqual({ number: 4, text: 1 });
    expect(effectiveType(rating)).toBe("text");
    expect(effectiveType(rating, "number")).toBe("number");
  });

  test("records presence and numeric range", () => {
    const rating = byName(fields, "rating");
    expect(rating.present).toBe(5);
    expect(rating.total).toBe(10);
    expect(byName(fields, "year").range).toEqual([1969, 2021]);
  });

  test("lists values by descending count", () => {
    expect(byName(fields, "status").values[0]).toEqual(["finished", 5]);
  });

  test("merges declared and inferred fields", () => {
    const tasks = [
      {
        name: "Send report",
        done: false,
        due: "2026-10-21",
        ref: "Work@1",
        itags: ["task"],
      },
      { name: "Fix bike", done: false, ref: "Home@2", itags: ["task"] },
    ];
    const merged = inferFields(
      tasks,
      {
        name: { type: "text" },
        done: { type: "boolean" },
        tags: { type: "list" },
      },
      true,
    );
    expect(byName(merged, "name").source).toBe("built-in");
    expect(byName(merged, "due").source).toBe("inferred");
    expect(byName(merged, "due").type).toBe("date");
    expect(byName(merged, "tags").present).toBe(0);
    expect(byName(merged, "ref").system).toBe(true);
    expect(byName(merged, "itags").system).toBe(true);
    expect(inferFields([{ toPos: 5 }], null, true)[0].system).toBe(true);
    expect(byName(merged, "name").system).toBe(false);
  });

  test("a declared plain text field takes the format its values all have", () => {
    const merged = inferFields(
      [
        { lastModified: "2026-10-16T08:12:00", name: "Dashboard" },
        { lastModified: "2026-10-15T17:40:00", name: "Work" },
      ],
      { lastModified: { type: "text" }, name: { type: "text" } },
      true,
    );
    expect(byName(merged, "lastModified").type).toBe("datetime");
    expect(byName(merged, "name").type).toBe("text");
  });

  test("a declared field of a custom tag is declared", () => {
    const merged = inferFields(
      [{ status: "active" }],
      { status: { type: "enum", enumValues: ["active", "paused"] } },
      false,
    );
    expect(byName(merged, "status").source).toBe("declared");
    expect(byName(merged, "status").enumValues).toEqual(["active", "paused"]);
  });

  test("nested records become dotted fields one level deep", () => {
    const nested = inferFields(
      [{ meta: { author: "Sam", deep: { x: 1 } } }],
      null,
      false,
    );
    expect(byName(nested, "meta.author").type).toBe("text");
    expect(byName(nested, "meta.deep").type).toBe("record");
    expect(nested.find((f) => f.name === "meta.deep.x")).toBeUndefined();
  });
});

describe("declaredFieldsFromSchema", () => {
  test("maps JSON Schema properties to field types", () => {
    expect(
      declaredFieldsFromSchema({
        type: "object",
        properties: {
          status: { type: "string", enum: ["active", "paused"] },
          deadline: { type: "string", format: "date" },
          seen: { type: "string", format: "date-time" },
          budget: { type: "number" },
          done: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
          phone: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      }),
    ).toEqual({
      status: { type: "enum", enumValues: ["active", "paused"] },
      deadline: { type: "date" },
      seen: { type: "datetime" },
      budget: { type: "number" },
      done: { type: "boolean" },
      tags: { type: "list" },
      phone: { type: "text" },
    });
  });

  test("no schema gives null", () => {
    expect(declaredFieldsFromSchema(null)).toBe(null);
  });
});

describe("tagDefineSnippet", () => {
  test("writes a tag.define with schema helpers and notes", () => {
    const fields = inferFields(
      books.map((b, i) => ({
        ...b,
        tags: ["reading"],
        finished: i < 3 ? "2026-03-02" : undefined,
      })),
      null,
      false,
    ).filter((f) =>
      ["title", "rating", "status", "tags", "finished"].includes(f.name),
    );
    const snippet = tagDefineSnippet("book", fields, { rating: "number" });
    const expected = [
      'name = "book",',
      'type = "object",',
      "title = schema.string(),",
      'status = { type = "string", enum = { "finished", "reading", "want" } },',
      "rating = schema.number(),",
      'tags = schema.array("string"),',
      "finished = schema.string(), -- date, YYYY-MM-DD",
    ];
    let at = 0;
    for (const line of expected) {
      const i = snippet.indexOf(line, at);
      expect(i, line).toBeGreaterThanOrEqual(0);
      at = i;
    }
    expect(snippet.startsWith("tag.define {")).toBe(true);
  });

  test("an un-overridden mixed field is noted", () => {
    const fields = inferFields(books, null, false).filter(
      (f) => f.name === "rating",
    );
    expect(tagDefineSnippet("book", fields, {})).toContain(
      "rating = schema.string(), -- seen as 4 number, 1 text",
    );
  });
});
