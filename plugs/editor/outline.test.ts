import { assertEquals } from "@std/assert";
import {
  type CursorContext,
  detectContext,
  indent,
  moveDown,
  moveUp,
  outdent,
  type OutlineResult,
} from "./outline_ops.ts";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";

const CURSOR = "|^|";

function applyOp(
  op: (text: string, cursor: number) => OutlineResult,
  input: string,
): string {
  const pos = input.indexOf(CURSOR);
  const clean = input.slice(0, pos) + input.slice(pos + CURSOR.length);
  const result = op(clean, pos);
  if (result === null || result === "blocked") {
    return input; // no-op returns unchanged
  }
  return result.text.slice(0, result.cursor) + CURSOR +
    result.text.slice(result.cursor);
}

function detect(marked: string): CursorContext | null {
  const pos = marked.indexOf(CURSOR);
  const text = marked.slice(0, pos) + marked.slice(pos + CURSOR.length);
  const tree = parseMarkdown(text);
  return detectContext(tree, pos);
}

// Bullet Lists: Move Up/Down
Deno.test("Bullet list move up/down", async (t) => {
  await t.step("swap two flat bullets", () => {
    assertEquals(
      applyOp(
        moveUp,
        `- first
- sec|^|ond
`,
      ),
      `- sec|^|ond
- first
`,
    );
    assertEquals(
      applyOp(
        moveDown,
        `- fir|^|st
- second
`,
      ),
      `- second
- fir|^|st
`,
    );
  });

  await t.step("boundary bullet is no-op", () => {
    const upInput = `- fir|^|st
- second
`;
    assertEquals(applyOp(moveUp, upInput), upInput);
    const downInput = `- first
- sec|^|ond
`;
    assertEquals(applyOp(moveDown, downInput), downInput);
  });

  await t.step("item with children moves as unit", () => {
    assertEquals(
      applyOp(
        moveUp,
        `- first
- sec|^|ond
  - child
`,
      ),
      `- sec|^|ond
  - child
- first
`,
    );
    assertEquals(
      applyOp(
        moveDown,
        `- fir|^|st
  - child
- second
`,
      ),
      `- second
- fir|^|st
  - child
`,
    );
  });

  await t.step("nested child: boundary no-op and swap", () => {
    const upBoundary = `- parent
  - child |^|one
  - child two
`;
    assertEquals(applyOp(moveUp, upBoundary), upBoundary);
    const downBoundary = `- parent
  - child one
  - child |^|two
`;
    assertEquals(applyOp(moveDown, downBoundary), downBoundary);

    assertEquals(
      applyOp(
        moveUp,
        `- parent
  - child one
  - child |^|two
`,
      ),
      `- parent
  - child |^|two
  - child one
`,
    );
    assertEquals(
      applyOp(
        moveDown,
        `- parent
  - child |^|one
  - child two
`,
      ),
      `- parent
  - child two
  - child |^|one
`,
    );
  });

  await t.step("three items, swap adjacent", () => {
    assertEquals(
      applyOp(
        moveUp,
        `- first
- second
- th|^|ird
`,
      ),
      `- first
- th|^|ird
- second
`,
    );
    assertEquals(
      applyOp(
        moveDown,
        `- fir|^|st
- second
- third
`,
      ),
      `- second
- fir|^|st
- third
`,
    );
  });
});

// Bullet Lists: Indent/Outdent
Deno.test("Bullet list indent/outdent", async (t) => {
  await t.step("indent then outdent flat bullet", () => {
    const flat = `- first
- sec|^|ond
`;
    const nested = `- first
  - sec|^|ond
`;
    assertEquals(applyOp(indent, flat), nested);
    assertEquals(applyOp(outdent, nested), flat);
  });

  await t.step("boundary no-ops", () => {
    const input = `- fir|^|st
- second
`;
    assertEquals(applyOp(indent, input), input);
    assertEquals(applyOp(outdent, input), input);
  });

  await t.step("with children", () => {
    const flat = `- first
- sec|^|ond
  - child
`;
    const nested = `- first
  - sec|^|ond
    - child
`;
    assertEquals(applyOp(indent, flat), nested);
    assertEquals(applyOp(outdent, nested), flat);
  });

  await t.step("already nested item indents further", () => {
    assertEquals(
      applyOp(
        indent,
        `- first
  - sec|^|ond
`,
      ),
      `- first
    - sec|^|ond
`,
    );
  });

  await t.step("deeply nested item outdents one level", () => {
    assertEquals(
      applyOp(
        outdent,
        `- first
  - second
    - th|^|ird
`,
      ),
      `- first
  - second
  - th|^|ird
`,
    );
  });
});

// Headers: Move Up/Down
Deno.test("Heading move up/down", async (t) => {
  await t.step("swap two h2 sections", () => {
    assertEquals(
      applyOp(
        moveUp,
        `## First
Content one
## Sec|^|ond
Content two
`,
      ),
      `## Sec|^|ond
Content two
## First
Content one
`,
    );
    assertEquals(
      applyOp(
        moveDown,
        `## Fir|^|st
Content one
## Second
Content two
`,
      ),
      `## Second
Content two
## Fir|^|st
Content one
`,
    );
  });

  await t.step("boundary heading is no-op", () => {
    const upInput = `## Fir|^|st
Content
## Second
`;
    assertEquals(applyOp(moveUp, upInput), upInput);
    const downInput = `## First
## Sec|^|ond
`;
    assertEquals(applyOp(moveDown, downInput), downInput);
  });

  await t.step("h2 with sub-headings moves entire section", () => {
    assertEquals(
      applyOp(
        moveUp,
        `## First
### Sub one
## Sec|^|ond
### Sub two
`,
      ),
      `## Sec|^|ond
### Sub two
## First
### Sub one
`,
    );
    assertEquals(
      applyOp(
        moveDown,
        `## Fir|^|st
### Sub one
## Second
### Sub two
`,
      ),
      `## Second
### Sub two
## Fir|^|st
### Sub one
`,
    );
  });

  await t.step("h3 swaps only within parent h2 scope", () => {
    assertEquals(
      applyOp(
        moveUp,
        `## Parent
### Sub one
### Sub |^|two
`,
      ),
      `## Parent
### Sub |^|two
### Sub one
`,
    );
  });

  await t.step("headings with no body text", () => {
    assertEquals(
      applyOp(
        moveUp,
        `## First
## Sec|^|ond
`,
      ),
      `## Sec|^|ond
## First
`,
    );
  });

  await t.step("no trailing newline preserves content", () => {
    assertEquals(
      applyOp(
        moveUp,
        `## First
Body
## Sec|^|ond
End`,
      ),
      `## Sec|^|ond
End
## First
Body`,
    );
    assertEquals(
      applyOp(
        moveDown,
        `## Fir|^|st
Body
## Second
End`,
      ),
      `## Second
End
## Fir|^|st
Body`,
    );
  });

  await t.step("empty body section swap preserves structure", () => {
    assertEquals(
      applyOp(
        moveDown,
        `## |^|A
## B
Body B
`,
      ),
      `## B
Body B
## |^|A
`,
    );
  });

  await t.step("no trailing newline, first has no body", () => {
    assertEquals(
      applyOp(
        moveDown,
        `## |^|A
## B
Body`,
      ),
      `## B
Body
## |^|A`,
    );
  });

  await t.step("roundtrip: move down then up returns to original", () => {
    const original = `## First
Body 1a
Body 1b
## Second
Body 2a
`;
    const after = moveDown(original, 4);
    if (after === null || after === "blocked") {
      throw new Error("moveDown returned " + after);
    }
    const back = moveUp(after.text, after.cursor);
    if (back === null || back === "blocked") {
      throw new Error("moveUp returned " + back);
    }
    assertEquals(back.text, original);
  });
});

// Headers: Indent/Outdent
Deno.test("Heading indent/outdent", async (t) => {
  await t.step("basic", () => {
    const h2 = `## He|^|ading
`;
    const h3 = `### He|^|ading
`;
    assertEquals(applyOp(indent, h2), h3);
    assertEquals(applyOp(outdent, h3), h2);
  });

  await t.step("level limit no-ops", () => {
    const h6 = `###### He|^|ading
`;
    assertEquals(applyOp(indent, h6), h6);
    const h1 = `# He|^|ading
`;
    assertEquals(applyOp(outdent, h1), h1);
  });

  await t.step("with sub-headings", () => {
    const shallow = `## Ma|^|in
### Sub
`;
    const deep = `### Ma|^|in
#### Sub
`;
    assertEquals(applyOp(indent, shallow), deep);
    assertEquals(applyOp(outdent, deep), shallow);
  });
});

// Paragraphs: Move Up/Down
Deno.test("Paragraph operations", async (t) => {
  await t.step("swap two consecutive paragraphs", () => {
    assertEquals(
      applyOp(
        moveUp,
        `First para.

Second |^|para.
`,
      ),
      `Second |^|para.

First para.
`,
    );
  });

  await t.step("boundary no-ops", () => {
    const upInput = `First |^|para.

Second para.
`;
    assertEquals(applyOp(moveUp, upInput), upInput);
    const downInput = `First para.

Second |^|para.
`;
    assertEquals(applyOp(moveDown, downInput), downInput);
  });

  await t.step("moves past an adjacent list block", () => {
    assertEquals(
      applyOp(
        moveDown,
        `Some |^|text.

- item one
- item two
`,
      ),
      `- item one
- item two

Some |^|text.
`,
    );
  });
});

// Ordered Lists: all operations
Deno.test("Ordered list operations", async (t) => {
  await t.step("move up", () => {
    assertEquals(
      applyOp(
        moveUp,
        `1. first
2. sec|^|ond
`,
      ),
      `1. sec|^|ond
2. first
`,
    );
  });

  await t.step("move down", () => {
    assertEquals(
      applyOp(
        moveDown,
        `1. fir|^|st
2. second
`,
      ),
      `1. second
2. fir|^|st
`,
    );
  });

  await t.step("indent", () => {
    assertEquals(
      applyOp(
        indent,
        `1. first
2. sec|^|ond
`,
      ),
      `1. first
   2. sec|^|ond
`,
    );
  });

  await t.step("outdent", () => {
    assertEquals(
      applyOp(
        outdent,
        `1. first
   2. sec|^|ond
`,
      ),
      `1. first
2. sec|^|ond
`,
    );
  });
});

// Edge Cases
Deno.test("Edge cases", async (t) => {
  await t.step("empty and single-item no-ops", () => {
    const empty = `|^|`;
    assertEquals(applyOp(moveUp, empty), empty);
    assertEquals(applyOp(moveDown, empty), empty);
    assertEquals(applyOp(indent, empty), empty);
    assertEquals(applyOp(outdent, empty), empty);

    const single = `- on|^|ly
`;
    assertEquals(applyOp(moveUp, single), single);
    assertEquals(applyOp(moveDown, single), single);
  });

  await t.step("nested boundary no-ops", async (t) => {
    await t.step("move down last item with sub-items", () => {
      const input = "- a\n- b|^|\n  - sub1\n  - sub2";
      assertEquals(applyOp(moveDown, input), input);
    });

    await t.step("move down last nested item", () => {
      const input = "- a\n- b\n  - sub1\n  - sub2|^|";
      assertEquals(applyOp(moveDown, input), input);
    });

    await t.step("move up first item with sub-items", () => {
      const input = "- a|^|\n  - sub\n- b";
      assertEquals(applyOp(moveUp, input), input);
    });

    await t.step("cursor at end of last nested item blocks move down", () => {
      const input = "- a\n- b\n  - sub1\n  - sub2|^|\n- c";
      assertEquals(applyOp(moveDown, input), input);
    });
  });

  await t.step("cursor on leading whitespace of nested item is no-op", () => {
    const input = "  - a\n  - b\n    - sub1\n  |^|  - sub2\n  - c";
    assertEquals(applyOp(moveDown, input), input);
  });

  await t.step("cursor at end of nested item moves within nested list", () => {
    assertEquals(
      applyOp(moveDown, "- a\n- b\n  - sub1|^|\n  - sub2\n- c"),
      "- a\n- b\n  - sub2\n  - sub1|^|\n- c",
    );
  });
});

// Context Detection
Deno.test("Cursor positions in bullet list", async (t) => {
  await t.step("on list marker", () => {
    const ctx = detect("|^|- one\n- two\n");
    assertEquals(ctx?.type, "listItem");
    assertEquals(ctx && "list" in ctx ? ctx.list.type : null, "BulletList");
  });

  await t.step("on space after marker", () => {
    assertEquals(detect("-|^| one\n- two\n")?.type, "listItem");
  });

  await t.step("on newline between items", () => {
    assertEquals(detect("- one|^|\n- two\n")?.type, "listItem");
  });

  await t.step("at last char of item text", () => {
    const ctx = detect("- on|^|e\n- two\n");
    assertEquals(ctx?.type, "listItem");
    if (ctx?.type === "listItem") {
      assertEquals(ctx.itemIndex, 0);
    }
  });

  await t.step("past end of document", () => {
    assertEquals(detect("- one\n- two\n|^|"), null);
  });
});

Deno.test("Cursor positions on heading", async (t) => {
  await t.step("on heading marker", () => {
    const ctx = detect("|^|## Heading\nBody\n");
    assertEquals(ctx?.type, "heading");
    if (ctx?.type === "heading") {
      assertEquals(ctx.level, 2);
    }
  });

  await t.step("on newline after heading", () => {
    assertEquals(detect("## Heading|^|\nBody\n")?.type, "heading");
  });
});

Deno.test("Context detection edge cases", async (t) => {
  await t.step("code block returns null", () => {
    assertEquals(detect("```\n|^|some code\n```\n"), null);
  });

  await t.step("frontmatter returns null", () => {
    assertEquals(detect("---\n|^|title: Test\n---\nContent\n"), null);
  });

  await t.step("between paragraphs resolves to preceding paragraph", () => {
    assertEquals(detect("Para one.|^|\n\nPara two.\n")?.type, "paragraph");
    assertEquals(detect("Para one.\n|^|\nPara two.\n"), null);
  });

  await t.step("paragraph inside list item detects list item", () => {
    assertEquals(detect("- ite|^|m text\n")?.type, "listItem");
  });

  await t.step("heading section boundaries are correct", () => {
    const ctx = detect("## |^|H2a\nBody\n### H3\nSub\n## H2b\n");
    assertEquals(ctx?.type, "heading");
    if (ctx?.type === "heading") {
      assertEquals(ctx.level, 2);
      const types = ctx.doc.children!.slice(ctx.sectionStart, ctx.sectionEnd)
        .filter((c) => c.type).map((c) => c.type);
      assertEquals(types, [
        "ATXHeading2",
        "Paragraph",
        "ATXHeading3",
        "Paragraph",
      ]);
    }
  });

  await t.step("deeply nested list item detects innermost list", () => {
    const ctx = detect("- parent\n  - child\n    - gra|^|ndchild\n");
    assertEquals(ctx?.type, "listItem");
    if (ctx?.type === "listItem") {
      assertEquals(ctx.list.type, "BulletList");
      assertEquals(ctx.item.from, 23);
    }
  });

  await t.step("paragraph after heading detects paragraph", () => {
    assertEquals(
      detect("## Heading\nBody|^| text here.\n")?.type,
      "paragraph",
    );
  });

  await t.step("single heading with no following content", () => {
    const ctx = detect("## On|^|ly heading\n");
    assertEquals(ctx?.type, "heading");
    if (ctx?.type === "heading") {
      assertEquals(ctx.sectionStart, 0);
      assertEquals(ctx.sectionEnd, ctx.doc.children!.length);
    }
  });
});

Deno.test("List marker variants", async (t) => {
  await t.step("ordered list", () => {
    const ctx = detect("|^|1. first\n2. second\n");
    assertEquals(ctx?.type, "listItem");
    assertEquals(ctx && "list" in ctx ? ctx.list.type : null, "OrderedList");
  });

  await t.step("* bullet", () => {
    const ctx = detect("|^|* item one\n* item two\n");
    assertEquals(ctx?.type, "listItem");
    assertEquals(ctx && "list" in ctx ? ctx.list.type : null, "BulletList");
  });

  await t.step("blockquote list", () => {
    assertEquals(detect("> - |^|item one\n> - item two\n")?.type, "listItem");
  });
});

// Table Rows: Move Up/Down
Deno.test("Table row move up/down", async (t) => {
  await t.step("swap two data rows", () => {
    assertEquals(
      applyOp(
        moveUp,
        `| A | B |
| --- | --- |
| 1 | 2 |
| 3|^| | 4 |
`,
      ),
      `| A | B |
| --- | --- |
| 3|^| | 4 |
| 1 | 2 |
`,
    );
    assertEquals(
      applyOp(
        moveDown,
        `| A | B |
| --- | --- |
| 1|^| | 2 |
| 3 | 4 |
`,
      ),
      `| A | B |
| --- | --- |
| 3 | 4 |
| 1|^| | 2 |
`,
    );
  });

  await t.step("first data row can't move up", () => {
    const input = `| A | B |
| --- | --- |
| 1|^| | 2 |
| 3 | 4 |
`;
    assertEquals(applyOp(moveUp, input), input);
  });

  await t.step("last data row can't move down", () => {
    const input = `| A | B |
| --- | --- |
| 1 | 2 |
| 3|^| | 4 |
`;
    assertEquals(applyOp(moveDown, input), input);
  });

  await t.step("header row is not movable", () => {
    const input = `| A|^| | B |
| --- | --- |
| 1 | 2 |
`;
    assertEquals(applyOp(moveUp, input), input);
    assertEquals(applyOp(moveDown, input), input);
  });

  await t.step("three rows, swap middle", () => {
    assertEquals(
      applyOp(
        moveUp,
        `| H1 | H2 |
| --- | --- |
| a | b |
| c|^| | d |
| e | f |
`,
      ),
      `| H1 | H2 |
| --- | --- |
| c|^| | d |
| a | b |
| e | f |
`,
    );
    assertEquals(
      applyOp(
        moveDown,
        `| H1 | H2 |
| --- | --- |
| a | b |
| c|^| | d |
| e | f |
`,
      ),
      `| H1 | H2 |
| --- | --- |
| a | b |
| e | f |
| c|^| | d |
`,
    );
  });

  await t.step("indent/outdent on table row is no-op", () => {
    const input = `| A | B |
| --- | --- |
| 1|^| | 2 |
`;
    assertEquals(applyOp(indent, input), input);
    assertEquals(applyOp(outdent, input), input);
  });
});

// Table Rows: Context Detection
Deno.test("Table row context detection", async (t) => {
  await t.step("cursor in data row detects tableRow", () => {
    const ctx = detect(`| A | B |
| --- | --- |
| 1|^| | 2 |
`);
    assertEquals(ctx?.type, "tableRow");
  });

  await t.step("cursor in header row detects tableRow with isHeader", () => {
    const ctx = detect(`| A|^| | B |
| --- | --- |
| 1 | 2 |
`);
    assertEquals(ctx?.type, "tableRow");
    if (ctx?.type === "tableRow") {
      assertEquals(ctx.isHeader, true);
    }
  });

  await t.step("cursor on delimiter row returns null", () => {
    assertEquals(
      detect(`| A | B |
| --|^|- | --- |
| 1 | 2 |
`),
      null,
    );
  });
});
