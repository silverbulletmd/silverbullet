import { assertEquals } from "@std/assert";
import { insertIntoPlugPage } from "./plugmanager.ts";

/** Convenience function simulating repeatedly calling `editor.replaceRange` */
function replaceRanges(
  pageText: string,
  ranges: Array<{ from: number; to: number; text: string }>,
): string {
  let result = pageText;
  for (const { from, to, text } of ranges) {
    result = result.substring(0, from) + text + result.substring(to);
  }
  return result;
}

const exampleURI = "test:my.plug.js";
const exampleBlock = `\`\`\`space-config
plugs:
- ${exampleURI}
\`\`\``;

Deno.test("Updating PLUGS page", () => {
  // Empty page
  let before = "";
  let after = replaceRanges(before, insertIntoPlugPage(exampleURI, before));
  assertEquals(after, exampleBlock);

  // Page with some content and newline
  before = "Lorem ipsum dolor sit amet.\n";
  let expected = `${before}${exampleBlock}`;
  after = replaceRanges(before, insertIntoPlugPage(exampleURI, before));
  assertEquals(after, expected);

  // Page without a newline at the end
  before = "Lorem ipsum dolor sit amet.";
  expected = `${before}\n${exampleBlock}`;
  after = replaceRanges(before, insertIntoPlugPage(exampleURI, before));
  assertEquals(after, expected);

  // Old PLUGS page
  before = `Old prelude

\`\`\`yaml
- test:old.plug.js
- test:another.plug.js
\`\`\`
Some stuff below`;
  expected = `Old prelude

\`\`\`space-config
plugs:
- test:old.plug.js
- test:another.plug.js
- test:my.plug.js
\`\`\`
Some stuff below`;
  after = replaceRanges(before, insertIntoPlugPage("test:my.plug.js", before));
  assertEquals(after, expected);

  // Page with an existing space config block
  before = `Page content
\`\`\`space-config
foo:
  bar: baz
\`\`\`
Some stuff below`;
  expected = `Page content
\`\`\`space-config
foo:
  bar: baz
plugs:
- test:my.plug.js
\`\`\`
Some stuff below`;
  after = replaceRanges(before, insertIntoPlugPage("test:my.plug.js", before));
  assertEquals(after, expected);

  // Append at the end of an existing plugs list
  before = `Page content
\`\`\`space-config
plugs:
- test:old.plug.js
# some comment
\`\`\`
`;
  expected = `Page content
\`\`\`space-config
plugs:
- test:old.plug.js
# some comment
- test:my.plug.js
\`\`\`
`;
  after = replaceRanges(before, insertIntoPlugPage("test:my.plug.js", before));
  assertEquals(after, expected);

  // Why would you do this to yourself?
  before = `I love square brackets
\`\`\`space-config
plugs: [ "test:old.plug.js" ]
\`\`\`
`;
  expected = `I love square brackets
\`\`\`space-config
plugs: [ "test:old.plug.js" , "test:my.plug.js" ]
\`\`\`
`;
  after = replaceRanges(before, insertIntoPlugPage("test:my.plug.js", before));
  assertEquals(after, expected);
});
