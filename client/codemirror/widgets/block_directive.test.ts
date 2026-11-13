import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import {
  blockDirectiveAt,
  blockDirectiveOnLine,
  showBlockDirectiveResult,
} from "./block_directive.ts";
import { canMoveBlock, deleteBlock, moveBlock } from "./block_span.ts";

const QUERY = "${query[[\n  from index.tag 'page'\n]]}";

function stateOf(doc: string, cursor = 0) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [extendedMarkdownLanguage],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/** The block `${…}` of `doc` (its first `$`) */
function blockOf(state: EditorState) {
  const block = blockDirectiveAt(state, state.doc.toString().indexOf("$"));
  if (!block) throw new Error("no block directive");
  return block;
}

const apply = (
  state: EditorState,
  spec: ReturnType<typeof deleteBlock> | undefined,
) => (spec ? state.update(spec).state : state);

describe("block ${…}", () => {
  test("is a ${…} on lines of its own, text around it or not", () => {
    expect(blockDirectiveAt(stateOf(`A\n\n${QUERY}\n\nB`), 3)).toMatchObject({
      expr: QUERY.slice(2, -1),
    });
    expect(blockDirectiveAt(stateOf("A\n${x}\nB"), 2)).toBeDefined();
    // Sharing a line with text: inline
    expect(blockDirectiveAt(stateOf("A ${x} b"), 2)).toBeUndefined();
    expect(blockDirectiveAt(stateOf("A\n${x} b"), 2)).toBeUndefined();
  });

  test("each of its lines knows it, and only the first is first", () => {
    const state = stateOf(`A\n\n${QUERY}\n\nB`);
    expect(blockDirectiveOnLine(state, 3)?.first).toBe(true);
    expect(blockDirectiveOnLine(state, 4)?.first).toBe(false);
    expect(blockDirectiveOnLine(state, 5)?.first).toBe(false);
    expect(blockDirectiveOnLine(state, 1)).toBeUndefined();
    expect(blockDirectiveOnLine(stateOf("A ${x} b"), 1)).toBeUndefined();
  });
});

describe("Move up / Move down", () => {
  test("moves past the next paragraph, the blank lines staying put", () => {
    const state = stateOf(`A\n\n${QUERY}\n\nB\nB2\n\nC`);
    const moved = apply(state, moveBlock(state, blockOf(state), 1));
    expect(moved.doc.toString()).toBe(`A\n\nB\nB2\n\n${QUERY}\n\nC`);
    const back = apply(moved, moveBlock(moved, blockOf(moved), -1));
    expect(back.doc.toString()).toBe(state.doc.toString());
  });

  test("moves past a whole list, and a heading line", () => {
    const state = stateOf(`# H\n${"${x}"}\n\n- a\n  - b\n- c`);
    const down = apply(state, moveBlock(state, blockOf(state), 1));
    expect(down.doc.toString()).toBe("# H\n- a\n  - b\n- c\n\n${x}");
    const up = apply(state, moveBlock(state, blockOf(state), -1));
    expect(up.doc.toString()).toBe("${x}\n# H\n\n- a\n  - b\n- c");
  });

  test("within a paragraph, moves past the text lines or the ${…} next to it", () => {
    const state = stateOf("A\nA2\n${x}\n${y}\nB");
    const x = blockDirectiveAt(state, state.doc.toString().indexOf("${x}"))!;
    const up = apply(state, moveBlock(state, x, -1));
    expect(up.doc.toString()).toBe("${x}\nA\nA2\n${y}\nB");
    const down = apply(state, moveBlock(state, x, 1));
    expect(down.doc.toString()).toBe("A\nA2\n${y}\n${x}\nB");
  });

  test("a cursor inside it moves along, so it stays open", () => {
    const doc = `A\n\n${QUERY}\n\nB`;
    const cursor = doc.indexOf("from");
    const state = stateOf(doc, cursor);
    const moved = apply(state, moveBlock(state, blockOf(state), 1));
    expect(moved.selection.main.head).toBe(
      moved.doc.toString().indexOf("from"),
    );
  });

  test("nothing to move past at the edges, past frontmatter, or nested", () => {
    const top = stateOf("${x}\n\nB");
    expect(canMoveBlock(top, blockOf(top), -1)).toBe(false);
    expect(moveBlock(top, blockOf(top), -1)).toBeUndefined();
    expect(canMoveBlock(top, blockOf(top), 1)).toBe(true);
    const fm = stateOf("---\na: 1\n---\n${x}");
    expect(canMoveBlock(fm, blockOf(fm), -1)).toBe(false);
    const nested = stateOf("- a\n\n  ${x}\n- b");
    expect(canMoveBlock(nested, blockOf(nested), 1)).toBe(false);
  });
});

describe("Delete", () => {
  const del = (doc: string) => {
    const state = stateOf(doc);
    return apply(state, deleteBlock(state, blockOf(state))).doc.toString();
  };

  test("removes the whole expression and one blank line beside it", () => {
    expect(del(`A\n\n${QUERY}\n\nB`)).toBe("A\n\nB");
    expect(del(`${QUERY}\n\nB`)).toBe("B");
    expect(del(`A\n\n${QUERY}`)).toBe("A");
    expect(del(`A\n\n${QUERY}\n`)).toBe("A\n");
    expect(del(`# H\n${QUERY}\n- a`)).toBe("# H\n- a");
    expect(del(QUERY)).toBe("");
  });
});

describe("Show result", () => {
  const cursorAfter = (doc: string) => {
    const state = stateOf(doc, doc.indexOf("$") + 2);
    const next = apply(state, showBlockDirectiveResult(state, blockOf(state)));
    const { from, to } = blockOf(next);
    const head = next.selection.main.head;
    return { outside: head < from || head > to, doc: next.doc.toString() };
  };

  test("moves the cursor out of the expression", () => {
    expect(cursorAfter(`A\n\n${QUERY}\n\nB`).outside).toBe(true);
    expect(cursorAfter(`A\n\n${QUERY}`).outside).toBe(true);
    // A page of only the expression gets a line after it
    expect(cursorAfter(QUERY)).toEqual({ outside: true, doc: `${QUERY}\n` });
  });
});
