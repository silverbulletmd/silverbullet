import "$sb/lib/syscall_mock.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import buildMarkdown from "../../common/markdown_parser/parser.ts";
import { assertEquals } from "../../test_deps.ts";
import { extractFeedItems } from "$sb/lib/feed.ts";
import { nodeDefToMDExt } from "../../common/markdown_parser/markdown_ext.ts";

const feedSample1 = `---
test: ignore me
---
# My first item
$myid
Some text

---

# My second item
[id: myid2][otherAttribute: 42]
And some text

---

Completely free form
`;

Deno.test("Test feed parsing", async () => {
  // Ad hoc added the NamedAnchor extension from the core plug-in inline here
  const lang = buildMarkdown([nodeDefToMDExt("NamedAnchor", {
    firstCharacters: ["$"],
    regex: "\\$[a-zA-Z\\.\\-\\/]+[\\w\\.\\-\\/]*",
  })]);
  const tree = parse(lang, feedSample1);
  const items = await extractFeedItems(tree);
  assertEquals(items.length, 3);
  assertEquals(items[0], {
    id: "myid",
    text: "Some text",
    title: "My first item",
  });
  assertEquals(items[1], {
    id: "myid2",
    attributes: {
      otherAttribute: 42,
    },
    title: "My second item",
    text: "And some text",
  });
  assertEquals(items[2].text, "Completely free form");
});
