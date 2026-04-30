import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import {
  cleanAnchor,
  collectAnchor,
  isValidAnchorName,
} from "./anchor.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";

describe("anchor helpers", () => {
  test("collectAnchor returns null when no anchor", () => {
    const tree = parseMarkdown("Just some text.");
    expect(collectAnchor(tree)).toBeNull();
  });

  test("collectAnchor returns the single anchor", () => {
    const tree = parseMarkdown("A line with $pete in it.");
    const a = collectAnchor(tree);
    expect(a?.name).toBe("pete");
    expect(typeof a?.from).toBe("number");
    expect(typeof a?.to).toBe("number");
  });

  test("collectAnchor with two anchors returns the first and reports duplicate", () => {
    const tree = parseMarkdown("A $first and $second on same line.");
    const a = collectAnchor(tree);
    expect(a?.name).toBe("first");
    expect(a?.duplicateInHost).toBe(true);
  });

  test("cleanAnchor strips NamedAnchor nodes from a clone", () => {
    const tree = parseMarkdown("Hello $toc1 world");
    cleanAnchor(tree);
    expect(renderToText(tree).trim()).toBe("Hello  world".trim());
  });

  test("isValidAnchorName", () => {
    expect(isValidAnchorName("pete")).toBe(true);
    expect(isValidAnchorName("a/b")).toBe(true);
    expect(isValidAnchorName("a:b")).toBe(true);
    expect(isValidAnchorName("a-b")).toBe(true);
    // `.` is excluded so a sentence-ending period is not consumed.
    expect(isValidAnchorName("a.b")).toBe(false);
    expect(isValidAnchorName("_foo")).toBe(true);
    expect(isValidAnchorName("1abc")).toBe(false);
    expect(isValidAnchorName("a b")).toBe(false);
    expect(isValidAnchorName("a!b")).toBe(false);
    expect(isValidAnchorName("")).toBe(false);
  });
});
