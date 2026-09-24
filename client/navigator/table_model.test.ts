import { expect, test } from "vitest";
import { inferColumns, tableValueParts } from "./table_model.ts";
import type { Row } from "./types.ts";

const rows: Row[] = [
  { primary: "First", obj: { name: "First", amount: 12 }, cells: ["1/2"] },
  { primary: "Missing", obj: { name: "Missing", extra: false } },
  { primary: "Second", obj: { amount: 3, name: "Second" }, cells: ["9/10"] },
  { primary: "Tie", obj: { amount: 3, name: "Tie" } },
];

test("inferred columns preserve source attribute order and append new attributes", () => {
  expect(inferColumns(rows).map((c) => c.attribute)).toEqual([
    "name",
    "amount",
    "extra",
  ]);
});

test("cell formatting distinguishes Markdown strings from literal JSON", () => {
  expect(tableValueParts(["**bold**", false, { a: "*literal*" }])).toEqual([
    { text: "**bold**", markdown: true },
    { text: ", ", markdown: false },
    { text: "false", markdown: false },
    { text: ", ", markdown: false },
    { text: '{"a":"*literal*"}', markdown: false },
  ]);
  expect(tableValueParts(undefined)).toEqual([]);
  expect(tableValueParts(12)).toEqual([{ text: "12", markdown: false }]);
});

test("ref columns render links and preserve aliases", () => {
  expect(tableValueParts("Maple", "ref")).toEqual([
    { text: "[[Maple]]", markdown: true },
  ]);
  expect(tableValueParts("[[Maple#Notes|Read]]", "ref")).toEqual([
    { text: "[[Maple#Notes|Read]]", markdown: true },
  ]);
  expect(tableValueParts("Maple#Notes]] **extra**", "ref")).toEqual([
    { text: "Maple#Notes]] **extra**", markdown: false },
  ]);
  const invalid = "[[Maple|Read]] **extra** [[Cedar]]";
  expect(tableValueParts(invalid, "ref")).toEqual([
    { text: invalid, markdown: false },
  ]);
});

test("typed text stays literal while markdown keeps formatting", () => {
  expect(tableValueParts("**bold**", "text")).toEqual([
    { text: "**bold**", markdown: false },
  ]);
  expect(tableValueParts("**bold**", "markdown")).toEqual([
    { text: "**bold**", markdown: true },
  ]);
  expect(tableValueParts(["Maple", "[[Cedar]]"], "ref")).toEqual([
    { text: "[[Maple]]", markdown: true },
    { text: ", ", markdown: false },
    { text: "[[Cedar]]", markdown: true },
  ]);
});

test("typed booleans normalize explicit boolean strings without Lua truthiness", () => {
  expect(tableValueParts("false", "boolean")).toEqual([
    { text: "false", markdown: false, boolean: false },
  ]);
  expect(tableValueParts(true, "boolean")).toEqual([
    { text: "true", markdown: false, boolean: true },
  ]);
  expect(tableValueParts("unknown", "boolean")).toEqual([
    { text: "unknown", markdown: false },
  ]);
});

test("typed URLs use safe absolute links and otherwise preserve literal text", () => {
  expect(tableValueParts("https://example.com/a_(b)", "url")).toEqual([
    {
      text: "https://example.com/a_(b)",
      markdown: false,
      url: "https://example.com/a_(b)",
    },
  ]);
  for (const value of [
    "javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,hello",
    "not a URL",
  ]) {
    expect(tableValueParts(value, "url")).toEqual([
      { text: value, markdown: false },
    ]);
  }
});
