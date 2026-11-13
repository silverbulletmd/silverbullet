import { expect, test } from "vitest";
import { headingLines, listifyLines, taskifyLines } from "./line_prefix.ts";

const CURSOR = "|^|";

/** Applies taskify at the `|^|` cursor (no selection) and renders the result. */
function taskify(input: string): string {
  const pos = input.indexOf(CURSOR);
  const text = input.slice(0, pos) + input.slice(pos + CURSOR.length);
  const result = taskifyLines(text, pos, pos, pos);
  if (!result) return input;
  const out =
    text.slice(0, result.from) + result.insert + text.slice(result.to);
  return out.slice(0, result.cursor) + CURSOR + out.slice(result.cursor);
}

test("an empty line becomes an empty task", () => {
  expect(taskify("first\n|^|\nlast")).toBe("first\n* [ ] |^|\nlast");
});

test("a paragraph line becomes a task, keeping the cursor on its word", () => {
  expect(taskify("buy mi|^|lk")).toBe("* [ ] buy mi|^|lk");
});

test("a bullet item gets a checkbox after its bullet", () => {
  expect(taskify("* one\n  * tw|^|o")).toBe("* one\n  * [ ] tw|^|o");
});

test("numbered and dash items keep their marker", () => {
  expect(taskify("1. fi|^|rst")).toBe("1. [ ] fi|^|rst");
  expect(taskify("- fi|^|rst")).toBe("- [ ] fi|^|rst");
});

test("an existing task is left alone", () => {
  expect(taskify("* [x] do|^|ne")).toBe("* [x] do|^|ne");
  expect(taskify("* [ ] |^|")).toBe("* [ ] |^|");
});

test("indentation of a plain line is kept", () => {
  expect(taskify("  inden|^|ted")).toBe("  * [ ] inden|^|ted");
});

test("a multi-line selection converts every line but skips blank ones", () => {
  const text = "* a\n\nb\n* [ ] c";
  const result = taskifyLines(text, 0, text.length, text.length);
  expect(result?.insert).toBe("* [ ] a\n\n* [ ] b\n* [ ] c");
  expect(result?.cursor).toBe(result!.insert.length);
});

function listify(input: string): string {
  const pos = input.indexOf(CURSOR);
  const text = input.slice(0, pos) + input.slice(pos + CURSOR.length);
  const result = listifyLines(text, pos, pos);
  const out =
    text.slice(0, result.from) + result.insert + text.slice(result.to);
  return out.slice(0, result.cursor) + CURSOR + out.slice(result.cursor);
}

test("listify on an empty line leaves the cursor after the bullet", () => {
  expect(listify("first\n|^|\nlast")).toBe("first\n* |^|\nlast");
  expect(listify("|^|")).toBe("* |^|");
});

test("listify at the start of a line keeps the cursor before its text", () => {
  expect(listify("a\n|^|bc")).toBe("a\n* |^|bc");
});

test("listify mid-line keeps the cursor on its character", () => {
  expect(listify("ab|^|c")).toBe("* ab|^|c");
});

test("listify keeps a line's indentation", () => {
  expect(listify("a\n  inden|^|ted")).toBe("a\n  * inden|^|ted");
});

test("listify prefixes each line of a selection, keeping blank lines", () => {
  const text = "a\nb\n\nc";
  expect(listifyLines(text, 0, text.length)).toEqual({
    from: 0,
    to: text.length,
    insert: "* a\n* b\n\n* c",
    cursor: undefined,
  });
});

/** Sets the heading level at the `|^|` cursor (no selection), rendering the result. */
function heading(input: string, level: number): string {
  const pos = input.indexOf(CURSOR);
  const text = input.slice(0, pos) + input.slice(pos + CURSOR.length);
  const result = headingLines(text, pos, pos, pos, level);
  if (!result) return input;
  const out =
    text.slice(0, result.from) + result.insert + text.slice(result.to);
  return out.slice(0, result.cursor) + CURSOR + out.slice(result.cursor);
}

test("heading: a paragraph line becomes a heading, keeping the cursor on its word", () => {
  expect(heading("Some ti|^|tle", 2)).toBe("## Some ti|^|tle");
  expect(heading("a\n|^|b\nc", 1)).toBe("a\n# |^|b\nc");
});

test("heading: a heading changes level or goes back to normal text", () => {
  expect(heading("## Ti|^|tle", 3)).toBe("### Ti|^|tle");
  expect(heading("#### Ti|^|tle", 1)).toBe("# Ti|^|tle");
  expect(heading("## Ti|^|tle", 0)).toBe("Ti|^|tle");
  // A cursor inside the marker goes to the start of the text
  expect(heading("#|^|# Title", 3)).toBe("### |^|Title");
  // Already that level: nothing to do
  expect(heading("## Ti|^|tle", 2)).toBe("## Ti|^|tle");
});

test("heading: normal text on a paragraph, and list items and tasks, are left alone", () => {
  expect(heading("Ti|^|tle", 0)).toBe("Ti|^|tle");
  expect(heading("- it|^|em", 2)).toBe("- it|^|em");
  expect(heading("* [ ] ta|^|sk", 2)).toBe("* [ ] ta|^|sk");
  expect(heading("1. it|^|em", 2)).toBe("1. it|^|em");
});

test("heading: a hashtag is text, not a marker; a quote keeps its marker", () => {
  expect(heading("#ta|^|g", 2)).toBe("## #ta|^|g");
  expect(heading("> quo|^|te", 2)).toBe("> ## quo|^|te");
  expect(heading("> ## quo|^|te", 0)).toBe("> quo|^|te");
});

test("heading: every line of a selection, skipping blank lines and list items", () => {
  const text = "a\n\n## b\n- c";
  expect(headingLines(text, 0, text.length, 0, 3)?.insert).toBe(
    "### a\n\n### b\n- c",
  );
});

test("heading: a cursor on a later line of a selection moves with its text", () => {
  const text = "a\nb";
  const result = headingLines(text, 0, text.length, text.length, 2);
  expect(result?.insert).toBe("## a\n## b");
  expect(result?.cursor).toBe(result!.insert.length);
});

test("an empty first line gives a forward range at position 0", () => {
  expect(headingLines("\nfoo", 0, 0, 0, 2)).toEqual({
    from: 0,
    to: 0,
    insert: "## ",
    cursor: 3,
  });
  expect(taskifyLines("\nfoo", 0, 0, 0)).toEqual({
    from: 0,
    to: 0,
    insert: "* [ ] ",
    cursor: 6,
  });
  expect(listifyLines("\nfoo", 0, 0)).toEqual({
    from: 0,
    to: 0,
    insert: "* ",
    cursor: 2,
  });
});
