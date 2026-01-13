import { assertEquals } from "@std/assert";
import { extractSnippet } from "./snippet.ts";

Deno.test("extractSnippetByIndentation", () => {
  const text = `* Item 1
  * Item 1.1
    * Item 1.1.1
      * Item 1.1.1.1
    * Item 1.1.2
  * Item 1.2
* Item 2
  * Item 2.1`;

  // Unindented line with children
  assertEquals(
    extractSnippet("test", text, text.indexOf("* Item 1")),
    "* Item 1\n  * Item 1.1\n    * Item 1.1.1\n      * Item 1.1.1.1\n    * Item 1.1.2\n  * Item 1.2",
  );

  // Indented line with children (left-aligned)
  assertEquals(
    extractSnippet("test", text, text.indexOf("Item 1.1")),
    "* Item 1.1\n  * Item 1.1.1\n    * Item 1.1.1.1\n  * Item 1.1.2",
  );

  // Deeply nested line (left-aligned)
  assertEquals(
    extractSnippet("test", text, text.indexOf("Item 1.1.1.1")),
    "* Item 1.1.1.1",
  );

  // Stops at sibling
  assertEquals(
    extractSnippet("test", text, text.indexOf("Item 1.2")),
    "* Item 1.2",
  );

  // Stops at empty line
  const text2 = `* Item A
  * Item A.1
    Content

  * Item A.2`;
  assertEquals(
    extractSnippet("test", text2, text2.indexOf("Item A.1")),
    "* Item A.1\n  Content",
  );

  // Header extracts only itself and strips # marker
  const text3 = `## Sub Header
More text`;
  assertEquals(
    extractSnippet("test", text3, text3.indexOf("## Sub Header")),
    "Sub Header",
  );

  // maxLines limits the number of lines
  const text4 = `* Item X
  * Item X.1
  * Item X.2
  * Item X.3
  * Item X.4`;
  assertEquals(
    extractSnippet("test", text4, text4.indexOf("* Item X"), 3),
    "* Item X\n  * Item X.1\n  * Item X.2\n...",
  );

  // maxLines limits the number of lines
  const text5 = `  * Item X
    * [ ] Hello`;
  const taskPos = text5.indexOf("* [ ]");
  assertEquals(
    extractSnippet("test", text5, text4.indexOf("* Item X")),
    `* Item X\n  * [ ] [[test@${taskPos}]] Hello`,
  );
});
