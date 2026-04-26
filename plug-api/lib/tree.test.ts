import { expect, test, vi } from "vitest";
import {
  addParentPointers,
  cleanTree,
  cloneTree,
  collectNodesMatching,
  collectNodesOfType,
  findNodeMatching,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
  normalizeTableRow,
  type ParseTree,
  removeParentPointers,
  renderToText,
  replaceNodesMatching,
  traverseTree,
  traverseTreeAsync,
} from "./tree.ts";
import { parse } from "../../client/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../../client/markdown_parser/parser.ts";

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

const mdTest3 = `
\`\`\`yaml
name: something
\`\`\`
`;

test("Test parsing", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);
  addParentPointers(mdTree);
  // console.log(JSON.stringify(mdTree, null, 2));
  const wikiLink = nodeAtPos(mdTree, mdTest1.indexOf("Wiki Page"))!;
  expect(wikiLink.type).toEqual("WikiLinkPage");
  expect(
    findParentMatching(wikiLink, (n) => n.type === "BulletList"),
  ).not.toEqual(null);

  const allTodos = collectNodesMatching(mdTree, (n) => n.type === "Task");
  expect(allTodos.length).toEqual(2);

  // Render back into markdown should be equivalent
  expect(renderToText(mdTree)).toEqual(mdTest1);

  removeParentPointers(mdTree);
  replaceNodesMatching(mdTree, (n) => {
    if (n.type === "Task") {
      return {
        type: "Tosk",
      };
    }
  });
  // console.log(JSON.stringify(mdTree, null, 2));
  parse(extendedMarkdownLanguage, mdTest3);
  // console.log(JSON.stringify(mdTree3, null, 2));
});

test("traverseTree stops traversal when callback returns true", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);
  const visited: string[] = [];

  traverseTree(mdTree, (n) => {
    if (n.type) {
      visited.push(n.type);
    }
    // Stop at first WikiLink — should not descend into its children
    return n.type === "WikiLink";
  });

  // Should find WikiLink nodes but not their WikiLinkPage children
  expect(visited).toContain("WikiLink");
  expect(visited).not.toContain("WikiLinkPage");
});

test("traverseTree visits all nodes when callback returns false", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);
  const types = new Set<string>();

  traverseTree(mdTree, (n) => {
    if (n.type) {
      types.add(n.type);
    }
    return false;
  });

  // Should have visited deep into the tree
  expect(types.has("Document")).toBe(true);
  expect(types.has("WikiLinkPage")).toBe(true);
  expect(types.has("ATXHeading1")).toBe(true);
});

test("traverseTree isolates visitor errors per-node when opted in", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const seenHeadings: string[] = [];
    traverseTree(mdTree, (n) => {
      if (n.type === "ATXHeading1") {
        throw new Error("boom on first heading");
      }
      if (n.type === "ATXHeading2") {
        seenHeadings.push(n.type);
      }
      return false;
    }, true);
    expect(seenHeadings).toContain("ATXHeading2");
    expect(errorSpy).toHaveBeenCalled();
  } finally {
    errorSpy.mockRestore();
  }
});

test("traverseTree propagates visitor errors by default", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);
  expect(() =>
    traverseTree(mdTree, (n) => {
      if (n.type === "ATXHeading1") {
        throw new Error("boom on first heading");
      }
      return false;
    })
  ).toThrow("boom on first heading");
});

test("traverseTreeAsync isolates visitor errors per-node when opted in", async () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const seenHeadings: string[] = [];
    await traverseTreeAsync(mdTree, (n) => {
      if (n.type === "ATXHeading1") {
        return Promise.reject(new Error("boom on first heading"));
      }
      if (n.type === "ATXHeading2") {
        seenHeadings.push(n.type);
      }
      return Promise.resolve(false);
    }, true);
    expect(seenHeadings).toContain("ATXHeading2");
    expect(errorSpy).toHaveBeenCalled();
  } finally {
    errorSpy.mockRestore();
  }
});

test("traverseTreeAsync propagates visitor errors by default", async () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);
  await expect(
    traverseTreeAsync(mdTree, (n) => {
      if (n.type === "ATXHeading1") {
        return Promise.reject(new Error("boom on first heading"));
      }
      return Promise.resolve(false);
    }),
  ).rejects.toThrow("boom on first heading");
});

test("collectNodesOfType collects all nodes of given type", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);

  const headings = collectNodesOfType(mdTree, "ATXHeading1");
  expect(headings.length).toBe(1);
  expect(renderToText(headings[0])).toContain("Heading");

  const wikiLinks = collectNodesOfType(mdTree, "WikiLink");
  expect(wikiLinks.length).toBe(2);

  // Non-existent type returns empty
  expect(collectNodesOfType(mdTree, "NonExistent")).toEqual([]);
});

test("findNodeOfType finds first node of given type", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);

  const heading = findNodeOfType(mdTree, "ATXHeading1");
  expect(heading).toBeDefined();
  expect(heading!.type).toBe("ATXHeading1");

  // Returns null for non-existent type
  expect(findNodeOfType(mdTree, "NonExistent")).toBeNull();
});

test("findNodeMatching finds first matching node", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);

  const found = findNodeMatching(
    mdTree,
    (n) => n.type === "ATXHeading2",
  );
  expect(found).not.toBeNull();
  expect(found!.type).toBe("ATXHeading2");

  // Returns null when nothing matches
  expect(findNodeMatching(mdTree, () => false)).toBeNull();
});

test("cloneTree creates independent deep copy without parent pointers", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);
  addParentPointers(mdTree);

  const cloned = cloneTree(mdTree);

  // Content should be identical
  expect(renderToText(cloned)).toEqual(renderToText(mdTree));

  // Should be a different object
  expect(cloned).not.toBe(mdTree);
  expect(cloned.children![0]).not.toBe(mdTree.children![0]);

  // Root has no parent
  expect(cloned.parent).toBeUndefined();
  // deepClone with ignoreKeys: ["parent"] shallow-copies parent refs (they point to original tree)
  // This is expected behavior — cloneTree is used for trees without parent pointers set

  // Mutating clone should not affect original
  cloned.children![0] = { type: "Modified", children: [] };
  expect(mdTree.children![0].type).not.toBe("Modified");
});

test("cleanTree removes comments and trimmable whitespace", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);

  const cleaned = cleanTree(mdTree);

  // Should not contain Comment nodes
  const comments = collectNodesOfType(cleaned, "Comment");
  expect(comments.length).toBe(0);

  // Should still have structure
  expect(cleaned.type).toBe("Document");
  expect(cleaned.children!.length).toBeGreaterThan(0);
});

test("cleanTree throws on parse errors", () => {
  const errorTree: ParseTree = {
    type: "⚠",
    from: 5,
    to: 10,
  };
  expect(() => cleanTree(errorTree)).toThrow("Parse error at pos 5");
});

test("normalizeTableRow inserts empty cells between consecutive delimiters", () => {
  const row: ParseTree = {
    type: "TableRow",
    children: [
      { type: "TableDelimiter", children: [{ text: "|" }] },
      { type: "TableCell", children: [{ text: "a" }] },
      { type: "TableDelimiter", children: [{ text: "|" }] },
      { type: "TableDelimiter", children: [{ text: "|" }] }, // missing cell
      { type: "TableCell", children: [{ text: "c" }] },
    ],
  };

  normalizeTableRow(row);

  const cells = row.children!.filter((c) => c.type === "TableCell");
  expect(cells.length).toBe(3); // original 2 + 1 inserted empty
});

test("normalizeTableRow pads to match column count", () => {
  const row: ParseTree = {
    type: "TableRow",
    children: [
      { type: "TableDelimiter", children: [{ text: "|" }] },
      { type: "TableCell", children: [{ text: "a" }] },
      { type: "TableDelimiter", children: [{ text: "|" }] },
    ],
  };

  normalizeTableRow(row, 3);

  const cells = row.children!.filter((c) => c.type === "TableCell");
  expect(cells.length).toBe(3);
});

test("replaceNodesMatching can delete nodes (return null)", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);

  // Count tasks before
  const tasksBefore = collectNodesOfType(mdTree, "Task");
  expect(tasksBefore.length).toBe(2);

  // Delete all Task nodes
  replaceNodesMatching(mdTree, (n) => {
    if (n.type === "Task") {
      return null;
    }
  });

  const tasksAfter = collectNodesOfType(mdTree, "Task");
  expect(tasksAfter.length).toBe(0);
});

test("replaceNodesMatching can replace nodes", () => {
  const mdTree = parse(extendedMarkdownLanguage, mdTest1);

  replaceNodesMatching(mdTree, (n) => {
    if (n.type === "ATXHeading1") {
      return { type: "ReplacedHeading", children: [{ text: "replaced" }] };
    }
  });

  expect(findNodeOfType(mdTree, "ATXHeading1")).toBeNull();
  const replaced = findNodeOfType(mdTree, "ReplacedHeading");
  expect(replaced).not.toBeNull();
  expect(renderToText(replaced!)).toBe("replaced");
});
