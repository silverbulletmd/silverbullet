import { expect, test } from "vitest";
import { taskifyLines } from "./taskify.ts";

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
