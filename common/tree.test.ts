import {expect, test} from "@jest/globals";
import {nodeAtPos, parse, render} from "./tree";

const mdTest1 = `
# Heading
## Sub _heading_ cool

Hello, this is some **bold** text and *italic*. And [a link](http://zef.me).

- This is a list
- With another item
- TODOs:
  - [ ] A task that's not yet done
  - [x] Hello
- And a _third_ one [[Wiki Page]] yo
`;

test("Run a Node sandbox", async () => {
  let mdTree = parse(mdTest1);
  console.log(JSON.stringify(mdTree, null, 2));
  expect(nodeAtPos(mdTree, 4)!.type).toBe("ATXHeading1");
  expect(nodeAtPos(mdTree, mdTest1.indexOf("Wiki Page"))!.type).toBe(
    "WikiLink"
  );
  expect(render(mdTree)).toBe(mdTest1);
});
