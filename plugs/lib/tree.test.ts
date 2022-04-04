import {expect, test} from "@jest/globals";
import {parse} from "../../common/tree";
import {addParentPointers, collectNodesMatching, findParentMatching, nodeAtPos, render,} from "./tree";

const mdTest1 = `
# Heading
## Sub _heading_ cool

Hello, this is some **bold** text and *italic*. And [a link](http://zef.me).

%% My comment here
%% And second line

And an @mention

http://zef.plus

- This is a list [[PageLink]]
- With another item
- TODOs:
  - [ ] A task that's not yet done
  - [x] Hello
- And a _third_ one [[Wiki Page]] yo
`;

const mdTest2 = `
Hello

* Item 1
*

Sup`;

test("Run a Node sandbox", async () => {
  let mdTree = parse(mdTest1);
  addParentPointers(mdTree);
  // console.log(JSON.stringify(mdTree, null, 2));
  let wikiLink = nodeAtPos(mdTree, mdTest1.indexOf("Wiki Page"))!;
  expect(wikiLink.type).toBe("WikiLink");
  expect(
    findParentMatching(wikiLink, (n) => n.type === "BulletList")
  ).toBeDefined();

  let allTodos = collectNodesMatching(mdTree, (n) => n.type === "Task");
  expect(allTodos.length).toBe(2);

  // Render back into markdown should be equivalent
  expect(render(mdTree)).toBe(mdTest1);

  let mdTree2 = parse(mdTest2);
  console.log(JSON.stringify(mdTree2, null, 2));
});
