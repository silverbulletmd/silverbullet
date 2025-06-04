import "./syscall_mock.ts";
import { parse } from "../../web/markdown_parser/parse_tree.ts";
import {
  cleanAttributes,
  extractAttributes,
} from "@silverbulletmd/silverbullet/lib/attribute";
import { assertEquals } from "@std/assert";
import { renderToText } from "./tree.ts";
import { extendedMarkdownLanguage } from "../../web/markdown_parser/parser.ts";

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

* [ ] Attribute in a task 
* Regular item 

1. Itemized list 
`;

Deno.test("Test attribute extraction", async () => {
  const tree = parse(extendedMarkdownLanguage, inlineAttributeSample);
  const toplevelAttributes = await extractAttributes(tree);
  // console.log("All attributes", toplevelAttributes);
  assertEquals(toplevelAttributes.name, "sup");
  assertEquals(toplevelAttributes.age, 42);
  assertEquals(toplevelAttributes.children, ["pete", "john", "mary"]);
  // Check if the attributes are still there
  assertEquals(renderToText(tree), inlineAttributeSample);
  // And now clean
  cleanAttributes(tree);
  assertEquals(renderToText(tree), cleanedInlineAttributeSample);
});
