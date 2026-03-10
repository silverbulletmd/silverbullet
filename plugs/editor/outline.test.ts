import { describe, expect, test } from "vitest";
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
describe("Bullet list move up/down", () => {
  test("swap two flat bullets", () => {
    expect(applyOp(
        moveUp,
        `- first
- sec|^|ond
`,
      )).toEqual(`- sec|^|ond
- first
`,);
    expect(applyOp(
        moveDown,
        `- fir|^|st
- second
`,
      )).toEqual(`- second
- fir|^|st
`,);
  });

  test("boundary bullet is no-op", () => {
    const upInput = `- fir|^|st
- second
`;
    expect(applyOp(moveUp, upInput)).toEqual(upInput);
    const downInput = `- first
- sec|^|ond
`;
    expect(applyOp(moveDown, downInput)).toEqual(downInput);
  });

  test("item with children moves as unit", () => {
    expect(applyOp(
        moveUp,
        `- first
- sec|^|ond
  - child
`,
      )).toEqual(`- sec|^|ond
  - child
- first
`,);
    expect(applyOp(
        moveDown,
        `- fir|^|st
  - child
- second
`,
      )).toEqual(`- second
- fir|^|st
  - child
`,);
  });

  test("nested child: boundary no-op and swap", () => {
    const upBoundary = `- parent
  - child |^|one
  - child two
`;
    expect(applyOp(moveUp, upBoundary)).toEqual(upBoundary);
    const downBoundary = `- parent
  - child one
  - child |^|two
`;
    expect(applyOp(moveDown, downBoundary)).toEqual(downBoundary);

    expect(applyOp(
        moveUp,
        `- parent
  - child one
  - child |^|two
`,
      )).toEqual(`- parent
  - child |^|two
  - child one
`,);
    expect(applyOp(
        moveDown,
        `- parent
  - child |^|one
  - child two
`,
      )).toEqual(`- parent
  - child two
  - child |^|one
`,);
  });

  test("three items, swap adjacent", () => {
    expect(applyOp(
        moveUp,
        `- first
- second
- th|^|ird
`,
      )).toEqual(`- first
- th|^|ird
- second
`,);
    expect(applyOp(
        moveDown,
        `- fir|^|st
- second
- third
`,
      )).toEqual(`- second
- fir|^|st
- third
`,);
  });
});

// Bullet Lists: Indent/Outdent
describe("Bullet list indent/outdent", () => {
  test("indent then outdent flat bullet", () => {
    const flat = `- first
- sec|^|ond
`;
    const nested = `- first
  - sec|^|ond
`;
    expect(applyOp(indent, flat)).toEqual(nested);
    expect(applyOp(outdent, nested)).toEqual(flat);
  });

  test("boundary no-ops", () => {
    const input = `- fir|^|st
- second
`;
    expect(applyOp(indent, input)).toEqual(input);
    expect(applyOp(outdent, input)).toEqual(input);
  });

  test("with children", () => {
    const flat = `- first
- sec|^|ond
  - child
`;
    const nested = `- first
  - sec|^|ond
    - child
`;
    expect(applyOp(indent, flat)).toEqual(nested);
    expect(applyOp(outdent, nested)).toEqual(flat);
  });

  test("already nested item indents further", () => {
    expect(applyOp(
        indent,
        `- first
  - sec|^|ond
`,
      )).toEqual(`- first
    - sec|^|ond
`,);
  });

  test("deeply nested item outdents one level", () => {
    expect(applyOp(
        outdent,
        `- first
  - second
    - th|^|ird
`,
      )).toEqual(`- first
  - second
  - th|^|ird
`,);
  });
});

// Headers: Move Up/Down
describe("Heading move up/down", () => {
  test("swap two h2 sections", () => {
    expect(applyOp(
        moveUp,
        `## First
Content one
## Sec|^|ond
Content two
`,
      )).toEqual(`## Sec|^|ond
Content two
## First
Content one
`,);
    expect(applyOp(
        moveDown,
        `## Fir|^|st
Content one
## Second
Content two
`,
      )).toEqual(`## Second
Content two
## Fir|^|st
Content one
`,);
  });

  test("boundary heading is no-op", () => {
    const upInput = `## Fir|^|st
Content
## Second
`;
    expect(applyOp(moveUp, upInput)).toEqual(upInput);
    const downInput = `## First
## Sec|^|ond
`;
    expect(applyOp(moveDown, downInput)).toEqual(downInput);
  });

  test("h2 with sub-headings moves entire section", () => {
    expect(applyOp(
        moveUp,
        `## First
### Sub one
## Sec|^|ond
### Sub two
`,
      )).toEqual(`## Sec|^|ond
### Sub two
## First
### Sub one
`,);
    expect(applyOp(
        moveDown,
        `## Fir|^|st
### Sub one
## Second
### Sub two
`,
      )).toEqual(`## Second
### Sub two
## Fir|^|st
### Sub one
`,);
  });

  test("h3 swaps only within parent h2 scope", () => {
    expect(applyOp(
        moveUp,
        `## Parent
### Sub one
### Sub |^|two
`,
      )).toEqual(`## Parent
### Sub |^|two
### Sub one
`,);
  });

  test("headings with no body text", () => {
    expect(applyOp(
        moveUp,
        `## First
## Sec|^|ond
`,
      )).toEqual(`## Sec|^|ond
## First
`,);
  });

  test("no trailing newline preserves content", () => {
    expect(applyOp(
        moveUp,
        `## First
Body
## Sec|^|ond
End`,
      )).toEqual(`## Sec|^|ond
End
## First
Body`,);
    expect(applyOp(
        moveDown,
        `## Fir|^|st
Body
## Second
End`,
      )).toEqual(`## Second
End
## Fir|^|st
Body`,);
  });

  test("empty body section swap preserves structure", () => {
    expect(applyOp(
        moveDown,
        `## |^|A
## B
Body B
`,
      )).toEqual(`## B
Body B
## |^|A
`,);
  });

  test("no trailing newline, first has no body", () => {
    expect(applyOp(
        moveDown,
        `## |^|A
## B
Body`,
      )).toEqual(`## B
Body
## |^|A`,);
  });

  test("roundtrip: move down then up returns to original", () => {
    const original = `## First
Body 1a
Body 1b
## Second
Body 2a
`;
    const after = moveDown(original, 4);
    if (after === null || after === "blocked") {
      throw new Error(`moveDown returned ${after}`);
    }
    const back = moveUp(after.text, after.cursor);
    if (back === null || back === "blocked") {
      throw new Error(`moveUp returned ${back}`);
    }
    expect(back.text).toEqual(original);
  });
});

// Headers: Indent/Outdent
describe("Heading indent/outdent", () => {
  test("basic", () => {
    const h2 = `## He|^|ading
`;
    const h3 = `### He|^|ading
`;
    expect(applyOp(indent, h2)).toEqual(h3);
    expect(applyOp(outdent, h3)).toEqual(h2);
  });

  test("level limit no-ops", () => {
    const h6 = `###### He|^|ading
`;
    expect(applyOp(indent, h6)).toEqual(h6);
    const h1 = `# He|^|ading
`;
    expect(applyOp(outdent, h1)).toEqual(h1);
  });

  test("with sub-headings", () => {
    const shallow = `## Ma|^|in
### Sub
`;
    const deep = `### Ma|^|in
#### Sub
`;
    expect(applyOp(indent, shallow)).toEqual(deep);
    expect(applyOp(outdent, deep)).toEqual(shallow);
  });
});

// Paragraphs: Move Up/Down
describe("Paragraph operations", () => {
  test("swap two consecutive paragraphs", () => {
    expect(applyOp(
        moveUp,
        `First para.

Second |^|para.
`,
      )).toEqual(`Second |^|para.

First para.
`,);
  });

  test("boundary no-ops", () => {
    const upInput = `First |^|para.

Second para.
`;
    expect(applyOp(moveUp, upInput)).toEqual(upInput);
    const downInput = `First para.

Second |^|para.
`;
    expect(applyOp(moveDown, downInput)).toEqual(downInput);
  });

  test("moves past an adjacent list block", () => {
    expect(applyOp(
        moveDown,
        `Some |^|text.

- item one
- item two
`,
      )).toEqual(`- item one
- item two

Some |^|text.
`,);
  });
});

// Ordered Lists: all operations
describe("Ordered list operations", () => {
  test("move up", () => {
    expect(applyOp(
        moveUp,
        `1. first
2. sec|^|ond
`,
      )).toEqual(`1. sec|^|ond
2. first
`,);
  });

  test("move down", () => {
    expect(applyOp(
        moveDown,
        `1. fir|^|st
2. second
`,
      )).toEqual(`1. second
2. fir|^|st
`,);
  });

  test("indent", () => {
    expect(applyOp(
        indent,
        `1. first
2. sec|^|ond
`,
      )).toEqual(`1. first
   2. sec|^|ond
`,);
  });

  test("outdent", () => {
    expect(applyOp(
        outdent,
        `1. first
   2. sec|^|ond
`,
      )).toEqual(`1. first
2. sec|^|ond
`,);
  });
});

// Edge Cases
describe("Edge cases", () => {
  test("empty and single-item no-ops", () => {
    const empty = `|^|`;
    expect(applyOp(moveUp, empty)).toEqual(empty);
    expect(applyOp(moveDown, empty)).toEqual(empty);
    expect(applyOp(indent, empty)).toEqual(empty);
    expect(applyOp(outdent, empty)).toEqual(empty);

    const single = `- on|^|ly
`;
    expect(applyOp(moveUp, single)).toEqual(single);
    expect(applyOp(moveDown, single)).toEqual(single);
  });

  describe("nested boundary no-ops", () => {
    test("move down last item with sub-items", () => {
      const input = "- a\n- b|^|\n  - sub1\n  - sub2";
      expect(applyOp(moveDown, input)).toEqual(input);
    });

    test("move down last nested item", () => {
      const input = "- a\n- b\n  - sub1\n  - sub2|^|";
      expect(applyOp(moveDown, input)).toEqual(input);
    });

    test("move up first item with sub-items", () => {
      const input = "- a|^|\n  - sub\n- b";
      expect(applyOp(moveUp, input)).toEqual(input);
    });

    test("cursor at end of last nested item blocks move down", () => {
      const input = "- a\n- b\n  - sub1\n  - sub2|^|\n- c";
      expect(applyOp(moveDown, input)).toEqual(input);
    });
  });

  test("cursor on leading whitespace of nested item is no-op", () => {
    const input = "  - a\n  - b\n    - sub1\n  |^|  - sub2\n  - c";
    expect(applyOp(moveDown, input)).toEqual(input);
  });

  test("cursor at end of nested item moves within nested list", () => {
    expect(applyOp(moveDown, "- a\n- b\n  - sub1|^|\n  - sub2\n- c")).toEqual("- a\n- b\n  - sub2\n  - sub1|^|\n- c",);
  });
});

// Context Detection
describe("Cursor positions in bullet list", () => {
  test("on list marker", () => {
    const ctx = detect("|^|- one\n- two\n");
    expect(ctx?.type).toEqual("listItem");
    expect(ctx && "list" in ctx ? ctx.list.type : null).toEqual("BulletList");
  });

  test("on space after marker", () => {
    expect(detect("-|^| one\n- two\n")?.type).toEqual("listItem");
  });

  test("on newline between items", () => {
    expect(detect("- one|^|\n- two\n")?.type).toEqual("listItem");
  });

  test("at last char of item text", () => {
    const ctx = detect("- on|^|e\n- two\n");
    expect(ctx?.type).toEqual("listItem");
    if (ctx?.type === "listItem") {
      expect(ctx.itemIndex).toEqual(0);
    }
  });

  test("past end of document", () => {
    expect(detect("- one\n- two\n|^|")).toEqual(null);
  });
});

describe("Cursor positions on heading", () => {
  test("on heading marker", () => {
    const ctx = detect("|^|## Heading\nBody\n");
    expect(ctx?.type).toEqual("heading");
    if (ctx?.type === "heading") {
      expect(ctx.level).toEqual(2);
    }
  });

  test("on newline after heading", () => {
    expect(detect("## Heading|^|\nBody\n")?.type).toEqual("heading");
  });
});

describe("Context detection edge cases", () => {
  test("code block returns null", () => {
    expect(detect("```\n|^|some code\n```\n")).toEqual(null);
  });

  test("frontmatter returns null", () => {
    expect(detect("---\n|^|title: Test\n---\nContent\n")).toEqual(null);
  });

  test("between paragraphs resolves to preceding paragraph", () => {
    expect(detect("Para one.|^|\n\nPara two.\n")?.type).toEqual("paragraph");
    expect(detect("Para one.\n|^|\nPara two.\n")).toEqual(null);
  });

  test("paragraph inside list item detects list item", () => {
    expect(detect("- ite|^|m text\n")?.type).toEqual("listItem");
  });

  test("heading section boundaries are correct", () => {
    const ctx = detect("## |^|H2a\nBody\n### H3\nSub\n## H2b\n");
    expect(ctx?.type).toEqual("heading");
    if (ctx?.type === "heading") {
      expect(ctx.level).toEqual(2);
      const types = ctx.doc.children!.slice(ctx.sectionStart, ctx.sectionEnd)
        .filter((c) => c.type).map((c) => c.type);
      expect(types).toEqual([
        "ATXHeading2",
        "Paragraph",
        "ATXHeading3",
        "Paragraph",
      ]);
    }
  });

  test("deeply nested list item detects innermost list", () => {
    const ctx = detect("- parent\n  - child\n    - gra|^|ndchild\n");
    expect(ctx?.type).toEqual("listItem");
    if (ctx?.type === "listItem") {
      expect(ctx.list.type).toEqual("BulletList");
      expect(ctx.item.from).toEqual(23);
    }
  });

  test("paragraph after heading detects paragraph", () => {
    expect(detect("## Heading\nBody|^| text here.\n")?.type).toEqual("paragraph",);
  });

  test("single heading with no following content", () => {
    const ctx = detect("## On|^|ly heading\n");
    expect(ctx?.type).toEqual("heading");
    if (ctx?.type === "heading") {
      expect(ctx.sectionStart).toEqual(0);
      expect(ctx.sectionEnd).toEqual(ctx.doc.children!.length);
    }
  });
});

describe("List marker variants", () => {
  test("ordered list", () => {
    const ctx = detect("|^|1. first\n2. second\n");
    expect(ctx?.type).toEqual("listItem");
    expect(ctx && "list" in ctx ? ctx.list.type : null).toEqual("OrderedList");
  });

  test("* bullet", () => {
    const ctx = detect("|^|* item one\n* item two\n");
    expect(ctx?.type).toEqual("listItem");
    expect(ctx && "list" in ctx ? ctx.list.type : null).toEqual("BulletList");
  });

  test("blockquote list", () => {
    expect(detect("> - |^|item one\n> - item two\n")?.type).toEqual("listItem");
  });
});

// Table Rows: Move Up/Down
describe("Table row move up/down", () => {
  test("swap two data rows", () => {
    expect(applyOp(
        moveUp,
        `| A | B |
| --- | --- |
| 1 | 2 |
| 3|^| | 4 |
`,
      )).toEqual(`| A | B |
| --- | --- |
| 3|^| | 4 |
| 1 | 2 |
`,);
    expect(applyOp(
        moveDown,
        `| A | B |
| --- | --- |
| 1|^| | 2 |
| 3 | 4 |
`,
      )).toEqual(`| A | B |
| --- | --- |
| 3 | 4 |
| 1|^| | 2 |
`,);
  });

  test("first data row can't move up", () => {
    const input = `| A | B |
| --- | --- |
| 1|^| | 2 |
| 3 | 4 |
`;
    expect(applyOp(moveUp, input)).toEqual(input);
  });

  test("last data row can't move down", () => {
    const input = `| A | B |
| --- | --- |
| 1 | 2 |
| 3|^| | 4 |
`;
    expect(applyOp(moveDown, input)).toEqual(input);
  });

  test("header row is not movable", () => {
    const input = `| A|^| | B |
| --- | --- |
| 1 | 2 |
`;
    expect(applyOp(moveUp, input)).toEqual(input);
    expect(applyOp(moveDown, input)).toEqual(input);
  });

  test("three rows, swap middle", () => {
    expect(applyOp(
        moveUp,
        `| H1 | H2 |
| --- | --- |
| a | b |
| c|^| | d |
| e | f |
`,
      )).toEqual(`| H1 | H2 |
| --- | --- |
| c|^| | d |
| a | b |
| e | f |
`,);
    expect(applyOp(
        moveDown,
        `| H1 | H2 |
| --- | --- |
| a | b |
| c|^| | d |
| e | f |
`,
      )).toEqual(`| H1 | H2 |
| --- | --- |
| a | b |
| e | f |
| c|^| | d |
`,);
  });

  test("indent/outdent on table row is no-op", () => {
    const input = `| A | B |
| --- | --- |
| 1|^| | 2 |
`;
    expect(applyOp(indent, input)).toEqual(input);
    expect(applyOp(outdent, input)).toEqual(input);
  });
});

// Table Rows: Context Detection
describe("Table row context detection", () => {
  test("cursor in data row detects tableRow", () => {
    const ctx = detect(`| A | B |
| --- | --- |
| 1|^| | 2 |
`);
    expect(ctx?.type).toEqual("tableRow");
  });

  test("cursor in header row detects tableRow with isHeader", () => {
    const ctx = detect(`| A|^| | B |
| --- | --- |
| 1 | 2 |
`);
    expect(ctx?.type).toEqual("tableRow");
    if (ctx?.type === "tableRow") {
      expect(ctx.isHeader).toEqual(true);
    }
  });

  test("cursor on delimiter row returns null", () => {
    expect(detect(`| A | B |
| --|^|- | --- |
| 1 | 2 |
`)).toEqual(null,);
  });
});
