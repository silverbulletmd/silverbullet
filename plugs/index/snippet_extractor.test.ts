import { assertEquals } from "$std/testing/asserts.ts";
import { extractSnippetAroundIndex } from "./snippet_extractor.ts";

Deno.test("SnippetExtractor", () => {
  const testText = `# Ongoing things
    This is all about [[Diplomas]], and stuff like that. More stuff.
    `;
  assertEquals(
    extractSnippetAroundIndex(testText, testText.indexOf("[[Diplomas]]")),
    "This is all about [[Diplomas]], and stuff like that.",
  );

  const testText2 =
    `A much much much much much much much much much much much longer sentence [[Diplomas]], that just keeps and keeps and keeps and keeps and keeps going.
  `;
  assertEquals(
    extractSnippetAroundIndex(testText2, testText2.indexOf("[[Diplomas]]")),
    "...much much much much much much much longer sentence [[Diplomas]], that just keeps and keeps and keeps and...",
  );
});
