import { expect, test } from "vitest";
import { extractSnippet } from "./snippet.ts";

test("extractSnippetByIndentation", () => {
  const text = `* Item 1
  * Item 1.1
    * Item 1.1.1
      * Item 1.1.1.1
    * Item 1.1.2
  * Item 1.2
* Item 2
  * Item 2.1`;

  // Unindented line with children
  expect(
    extractSnippet("test", text, text.indexOf("* Item 1")),
  ).toEqual("* Item 1\n  * Item 1.1\n    * Item 1.1.1\n      * Item 1.1.1.1\n    * Item 1.1.2\n  * Item 1.2");

  // Indented line with children (left-aligned)
  expect(
    extractSnippet("test", text, text.indexOf("Item 1.1")),
  ).toEqual("* Item 1.1\n  * Item 1.1.1\n    * Item 1.1.1.1\n  * Item 1.1.2");

  // Deeply nested line (left-aligned)
  expect(
    extractSnippet("test", text, text.indexOf("Item 1.1.1.1")),
  ).toEqual("* Item 1.1.1.1");

  // Stops at sibling
  expect(
    extractSnippet("test", text, text.indexOf("Item 1.2")),
  ).toEqual("* Item 1.2");

  // Stops at empty line
  const text2 = `* Item A
  * Item A.1
    Content

  * Item A.2`;
  expect(
    extractSnippet("test", text2, text2.indexOf("Item A.1")),
  ).toEqual("* Item A.1\n  Content");

  // Header extracts only itself and strips # marker
  const text3 = `## Sub Header
More text`;
  expect(
    extractSnippet("test", text3, text3.indexOf("## Sub Header")),
  ).toEqual("Sub Header");

  // maxLines limits the number of lines
  const text4 = `* Item X
  * Item X.1
  * Item X.2
  * Item X.3
  * Item X.4`;
  expect(
    extractSnippet("test", text4, text4.indexOf("* Item X"), 3),
  ).toEqual("* Item X\n  * Item X.1\n  * Item X.2\n...");

  // maxLines limits the number of lines
  const text5 = `  * Item X
    * [ ] Hello`;
  const taskPos = text5.indexOf("* [ ]");
  expect(
    extractSnippet("test", text5, text4.indexOf("* Item X")),
  ).toEqual(`* Item X\n  * [ ] [[test@${taskPos}]] Hello`);
});
