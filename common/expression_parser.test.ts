import { assertEquals } from "@std/assert";
import { parseExpression } from "$common/expression_parser.ts";

Deno.test("Test expression parser", () => {
  // Just a sanity check here
  assertEquals(parseExpression("1 + 2"), ["+", ["number", 1], ["number", 2]]);
});
