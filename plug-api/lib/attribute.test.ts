import "$sb/lib/syscall_mock.ts";
import { parse } from "$common/markdown_parser/parse_tree.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { assertEquals } from "$std/testing/asserts.ts";
import { renderToText } from "./tree.ts";
import { extendedMarkdownLanguage } from "$common/markdown_parser/parser.ts";

const inlineAttributeSample = `
# My document
Top level attributes: [name:: sup] [age:: 42] [children: [pete, "john", mary]]

* [ ] Attribute in a task [tag:: foo]
* Regular item [tag:: bar]

1. Itemized list [tag:: baz]
`;

const cleanedInlineAttributeSample = `
# My document
Top level attributes:   

* [ ] Attribute in a task [tag:: foo]
* Regular item [tag:: bar]

1. Itemized list [tag:: baz]
`;

Deno.test("Test attribute extraction", async () => {
  const tree = parse(extendedMarkdownLanguage, inlineAttributeSample);
  const toplevelAttributes = await extractAttributes(["test"], tree, false);
  // console.log("All attributes", toplevelAttributes);
  assertEquals(toplevelAttributes.name, "sup");
  assertEquals(toplevelAttributes.age, 42);
  assertEquals(toplevelAttributes.children, ["pete", "john", "mary"]);
  // Check if the attributes are still there
  assertEquals(renderToText(tree), inlineAttributeSample);
  // Now once again with cleaning
  await extractAttributes(["test"], tree, true);
  assertEquals(renderToText(tree), cleanedInlineAttributeSample);
});
