import { assertEquals } from "@std/assert";
import { extractSnippetAroundIndex } from "./snippet_extractor.ts";

Deno.test("SnippetExtractor", () => {
  const testText = `# Ongoing things
    This is all about [[Diplomas]], and stuff like that. More stuff.
    `;
  assertEquals(
    extractSnippetAroundIndex(testText, testText.indexOf("[[Diplomas]]")),
    "# Ongoing things This is all about [[Diplomas]], and stuff like that. More stuff.",
  );

  const testText2 =
    `A much much much much much much much much much much much longer sentence [[Diplomas]], that just keeps and keeps and keeps and keeps and keeps going.
  `;
  assertEquals(
    extractSnippetAroundIndex(testText2, testText2.indexOf("[[Diplomas]]")),
    "A much much much much much much much much much much much longer sentence [[Diplomas]], that just keeps and keeps and keeps and keeps and keeps going.",
  );

  // Multi-line behavior
  const testText3 = `Line 1
Line 2 with [[Reference]]
Line 3
Line 4
Line 5`;
  assertEquals(
    extractSnippetAroundIndex(testText3, testText3.indexOf("[[Reference]]")),
    "Line 1 Line 2 with [[Reference]] Line 3",
  );

  // Long line with reference - ensure reference stays visible and centered
  const longText = "Type the name of a non-existent page to create it.".repeat(
    10,
  );
  const testText4 =
    `Click on the page picker (book icon) icon at the top right, or hit \`Cmd-k\` (Mac) or \`Ctrl-k\` (Linux and Windows) to open the **page picker**.
  * ${longText} Don't worry about folders existing, [[SilverBullet]] will automatically create them if they don't.
  * Another line here`;
  const result = extractSnippetAroundIndex(
    testText4,
    testText4.indexOf("[[SilverBullet]]"),
  );

  // Reference should always be visible in the result
  assertEquals(result.includes("[[SilverBullet]]"), true);
  // ... should also contain some context around it
  assertEquals(result.includes("create them"), true);
  // ... should not start with the very beginning of the long repeated text
  assertEquals(result.startsWith("..."), true);

  // Edge case: index beyond text bounds (triggers fallback)
  const testText5 = "Hello\nWorld\nTest";
  const beyondBoundsIndex = testText5.length + 10;
  const fallbackResult = extractSnippetAroundIndex(
    testText5,
    beyondBoundsIndex,
  );
  // Fallback should return something, not break
  assertEquals(typeof fallbackResult, "string");
});
