import { expect, test } from "vitest";
import { extractDefinitions } from "./page_definitions.ts";

const page = [
  "${salary = 500} and ${salary * 2}",
  "",
  "```lua",
  "-- ${notADefinition = 1}",
  "```",
  "",
  "Raise ${increase = 5}% ${local hidden = 1}",
].join("\n");

test("collects assignments in document order", () => {
  const { definitions, duplicateNames } = extractDefinitions(page);
  expect(definitions).toEqual([
    { name: "salary", exprSource: " 500" },
    { name: "increase", exprSource: " 5" },
    { name: "hidden", exprSource: " 1" },
  ]);
  expect(duplicateNames.size).toBe(0);
});

test("fingerprint ignores prose but tracks definitions", () => {
  const a = extractDefinitions(page).fingerprint;
  expect(extractDefinitions(`Intro\n\n${page}`).fingerprint).toBe(a);
  expect(
    extractDefinitions(page.replace("increase = 5", "increase = 7"))
      .fingerprint,
  ).not.toBe(a);
  expect(extractDefinitions("Just ${1 + 1}").fingerprint).toBe("");
});

test("reports duplicate assignment names", () => {
  const { duplicateNames } = extractDefinitions("${x = 1} ${x = 2} ${y = 3}");
  expect([...duplicateNames]).toEqual(["x"]);
});

test("template pages have no definitions", () => {
  const tpl = "---\ntags: meta/template\n---\n${x = 1}";
  expect(extractDefinitions(tpl).definitions).toEqual([]);
  expect(extractDefinitions("#meta/template\n${x = 1}").definitions).toEqual(
    [],
  );
});

test("returns the page's frontmatter from the same parse", () => {
  const { frontmatter } = extractDefinitions("---\nrate: 5\n---\n${x = 1}");
  expect(frontmatter).toEqual({ rate: 5 });
  expect(extractDefinitions("---\n: [bad\n---\n").frontmatter).toEqual({});
});
