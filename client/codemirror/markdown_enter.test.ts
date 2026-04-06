import { describe, expect, test } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { customEnterCommand } from "./markdown_enter.ts";

const CURSOR = "|^|";

function runEnter(input: string): string | false {
  const cursorPos = input.indexOf(CURSOR);
  const doc = input.slice(0, cursorPos) + input.slice(cursorPos + CURSOR.length);

  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursorPos),
    extensions: [markdown()],
  });

  // Force synchronous parse of the full document
  ensureSyntaxTree(state, state.doc.length);

  let newState: EditorState | null = null;
  const result = customEnterCommand({
    state,
    dispatch: (tr) => {
      newState = tr.state;
    },
  });

  if (!result || !newState) return false;

  const newDoc = (newState as EditorState).doc.toString();
  const newCursor = (newState as EditorState).selection.main.head;

  return newDoc.slice(0, newCursor) + CURSOR + newDoc.slice(newCursor);
}

// --- Bullet lists ---

describe("Enter in bullet lists", () => {
  test("colon at end creates indented child", () => {
    expect(runEnter("- groceries:|^|")).toBe("- groceries:\n  - |^|");
  });

  test("no colon creates sibling", () => {
    expect(runEnter("- buy milk|^|")).toBe("- buy milk\n- |^|");
  });

  test("empty item exits list", () => {
    expect(runEnter("- item one\n- |^|")).toBe("- item one\n|^|");
  });

  test("preserves * bullet with colon", () => {
    expect(runEnter("* note:|^|")).toBe("* note:\n  * |^|");
  });

  test("preserves + bullet with colon", () => {
    expect(runEnter("+ ideas:|^|")).toBe("+ ideas:\n  + |^|");
  });

  test("trailing whitespace before cursor is trimmed", () => {
    expect(runEnter("- stuff:   |^|")).toBe("- stuff:\n  - |^|");
  });
});

// --- Ordered lists ---

describe("Enter in ordered lists", () => {
  test("colon at end creates indented 1.", () => {
    expect(runEnter("1. overview:|^|")).toBe("1. overview:\n   1. |^|");
  });

  test("no colon creates next number", () => {
    expect(runEnter("1. first item|^|")).toBe("1. first item\n2. |^|");
  });

  test("preserves ) delimiter with colon", () => {
    expect(runEnter("3) section:|^|")).toBe("3) section:\n   1) |^|");
  });

  test("renumbers subsequent siblings", () => {
    expect(runEnter("1. first|^|\n2. second")).toBe(
      "1. first\n2. |^|\n3. second",
    );
  });
});

// --- Nested lists ---

describe("Enter in nested lists", () => {
  test("nested bullet with colon indents deeper", () => {
    expect(runEnter("- parent:\n  - child:|^|")).toBe(
      "- parent:\n  - child:\n    - |^|",
    );
  });

  test("nested bullet without colon creates sibling", () => {
    expect(runEnter("- parent\n  - child|^|")).toBe(
      "- parent\n  - child\n  - |^|",
    );
  });

  test("empty nested item exits to parent level", () => {
    expect(runEnter("- parent\n  - |^|")).toBe("- parent\n- |^|");
  });
});

// --- Task lists ---

describe("Enter in task lists", () => {
  test("task with colon creates indented child task", () => {
    expect(runEnter("- [x] project tasks:|^|")).toBe(
      "- [x] project tasks:\n  - [ ] |^|",
    );
  });

  test("task without colon creates sibling task", () => {
    expect(runEnter("- [x] done item|^|")).toBe("- [x] done item\n- [ ] |^|");
  });

  test("unchecked task with colon creates indented child task", () => {
    expect(runEnter("- [ ] parent task:|^|")).toBe(
      "- [ ] parent task:\n  - [ ] |^|",
    );
  });

  test("nested task with colon indents deeper", () => {
    expect(runEnter("- [ ] parent:\n  - [ ] child:|^|")).toBe(
      "- [ ] parent:\n  - [ ] child:\n    - [ ] |^|",
    );
  });

  test("task in blockquote with colon", () => {
    expect(runEnter("> - [x] tasks:|^|")).toBe("> - [x] tasks:\n>   - [ ] |^|");
  });
});

// --- Colon not at end of line ---

describe("colon not at end of line", () => {
  test("colon in key: value does not indent", () => {
    expect(runEnter("- key: value|^|")).toBe("- key: value\n- |^|");
  });

  test("colon in time does not indent", () => {
    expect(runEnter("- 10:30 meeting|^|")).toBe("- 10:30 meeting\n- |^|");
  });

  test("colon in URL does not indent", () => {
    expect(runEnter("- see https://example.com|^|")).toBe(
      "- see https://example.com\n- |^|",
    );
  });
});

// --- Non-tight lists (no extra blank lines) ---

describe("non-tight lists", () => {
  test("no blank line inserted before new item", () => {
    expect(runEnter("- a\n\n- b|^|")).toBe("- a\n\n- b\n- |^|");
  });
});

// --- Blockquotes ---

describe("blockquote behavior unchanged", () => {
  test("continues blockquote", () => {
    expect(runEnter("> text|^|")).toBe("> text\n> |^|");
  });

  test("list in blockquote with colon", () => {
    expect(runEnter("> - items:|^|")).toBe("> - items:\n>   - |^|");
  });
});

// --- Non-list context ---

describe("non-list context falls through", () => {
  test("plain paragraph returns false", () => {
    expect(runEnter("hello:|^|")).toBe(false);
  });

  test("empty document returns false", () => {
    expect(runEnter("|^|")).toBe(false);
  });
});
