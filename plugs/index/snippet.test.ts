import { assertEquals } from "../../test_deps.ts";
import { extractSnippet } from "./page_links.ts";

Deno.test("Snippet extraction", () => {
  const sample1 = `This is a test
and a [[new]] line that runs super duper duper duper duper duper long
[[SETTINGS]]
    super`;
  assertEquals(
    extractSnippet(sample1, sample1.indexOf("[[new]]")),
    "and a [[new]] line that runs sup",
  );
  assertEquals(
    extractSnippet(sample1, sample1.indexOf("[[SETTINGS]]")),
    "[[SETTINGS]]",
  );
});
