import "$sb/lib/syscall_mock.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import buildMarkdown from "../../common/markdown_parser/parser.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { assertEquals } from "../../test_deps.ts";
import { renderToText } from "$sb/lib/tree.ts";

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
  const lang = buildMarkdown([]);
  const tree = parse(lang, inlineAttributeSample);
  const toplevelAttributes = await extractAttributes(tree, false);
  // console.log("All attributes", toplevelAttributes);
  assertEquals(toplevelAttributes.name, "sup");
  assertEquals(toplevelAttributes.age, 42);
  assertEquals(toplevelAttributes.children, ["pete", "john", "mary"]);
  // Check if the attributes are still there
  assertEquals(renderToText(tree), inlineAttributeSample);
  // Now once again with cleaning
  await extractAttributes(tree, true);
  assertEquals(renderToText(tree), cleanedInlineAttributeSample);
});
