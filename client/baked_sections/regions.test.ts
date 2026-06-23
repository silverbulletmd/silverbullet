import { expect, test } from "vitest";
import { escapeBakedBody, findBakedSections } from "./regions.ts";

test("findBakedSections finds a single section, its body span, and full span", () => {
  const text = "before\n<!--#lua 3 + 4 -->\nstale\n<!--/lua-->\nafter";
  const sections = findBakedSections(text);
  expect(sections).toHaveLength(1);
  expect(sections[0].expr).toBe("3 + 4");
  expect(text.slice(sections[0].bodyFrom, sections[0].bodyTo)).toBe(
    "\nstale\n",
  );
  // start..end spans the whole section including both markers.
  expect(text.slice(sections[0].start, sections[0].end)).toBe(
    "<!--#lua 3 + 4 -->\nstale\n<!--/lua-->",
  );
});

test("findBakedSections finds multiple sections in order", () => {
  const text =
    "<!--#lua a -->\nx\n<!--/lua-->\nmid\n<!--#lua b -->\ny\n<!--/lua-->";
  const sections = findBakedSections(text);
  expect(sections.map((s) => s.expr)).toEqual(["a", "b"]);
});

test("findBakedSections ignores an unclosed opening marker", () => {
  const text = "<!--#lua oops -->\nbody with no close marker";
  expect(findBakedSections(text)).toHaveLength(0);
});

test("findBakedSections handles an empty body", () => {
  const text = "<!--#lua 1 --><!--/lua-->";
  const sections = findBakedSections(text);
  expect(sections).toHaveLength(1);
  expect(sections[0].bodyFrom).toBe(sections[0].bodyTo);
});

test("findBakedSections captures a multi-line expression", () => {
  const text = "<!--#lua query[[\n  from x\n]] -->\nold\n<!--/lua-->";
  const sections = findBakedSections(text);
  expect(sections).toHaveLength(1);
  expect(sections[0].expr).toBe("query[[\n  from x\n]]");
});

test("escapeBakedBody neutralizes a nested closing marker", () => {
  expect(escapeBakedBody("a <!--/lua--> b")).toBe("a <!-- /lua --> b");
  // After escaping, the nested marker is no longer matched as a section close.
  const text = `<!--#lua x -->\n${escapeBakedBody("<!--/lua-->")}\n<!--/lua-->`;
  expect(findBakedSections(text)).toHaveLength(1);
});
