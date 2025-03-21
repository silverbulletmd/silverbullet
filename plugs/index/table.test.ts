import { assertEquals } from "@std/assert/equals";
import { extractObjects } from "./table.ts";
import { parseMarkdown } from "$common/markdown_parser/parser.ts";

Deno.test("Table object data", () => {
  // Not checking the references, only that the object properties are assigned correctly
  const tree = parseMarkdown(`
|Description|Foo|Bar|
|-----------|---|---|
|Row 1      |A1 |B1 |
|Row 2      |A2 |B2 |
`);
  const indexed = extractObjects({ name: "Test Page", tree });
  assertEquals(indexed.length, 2);

  const row1 = indexed[0];
  assertEquals(row1.description, "Row 1");
  assertEquals(row1.foo, "A1");
  assertEquals(row1.bar, "B1");

  const row2 = indexed[1];
  assertEquals(row2.description, "Row 2");
  assertEquals(row2.foo, "A2");
  assertEquals(row2.bar, "B2");
});

Deno.test("Table object with missing cells", () => {
  // Not checking the references, only that the object properties are assigned correctly
  const tree = parseMarkdown(`
|Description|Foo|Bar|
|-----------|---|---|
|Row 1      |A1 |   |
|Row 2      |   |B2 |
`);

  const indexed = extractObjects({ name: "Test Page", tree });
  assertEquals(indexed.length, 2);

  const row1 = indexed[0];
  assertEquals(row1.description, "Row 1");
  assertEquals(row1.foo, "A1");
  assertEquals(row1.bar, undefined);

  const row2 = indexed[1];
  assertEquals(row2.description, "Row 2");
  assertEquals(row2.foo, undefined);
  assertEquals(row2.bar, "B2");
});
