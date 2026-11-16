import { expect, test } from "vitest";
import { parseAssignmentDirective } from "./assignment_directive.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import {
  findNodeOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";

test("recognizes name = expr", () => {
  expect(parseAssignmentDirective("salary = 500")).toEqual({
    name: "salary",
    nameOffset: 0,
    exprSource: " 500",
    exprOffset: 8,
    local: false,
  });
  expect(parseAssignmentDirective("  rate=0.2")?.name).toBe("rate");
});

test("recognizes local name = expr", () => {
  expect(parseAssignmentDirective(" local  rate = 0.2")).toEqual({
    name: "rate",
    nameOffset: 8,
    exprSource: " 0.2",
    exprOffset: 14,
    local: true,
    localOffset: 1,
  });
  // `localx` is just a name
  expect(parseAssignmentDirective("localx = 1")?.local).toBe(false);
});

test("ignores comparisons and non-assignments", () => {
  expect(parseAssignmentDirective("a == b")).toBeNull();
  expect(parseAssignmentDirective("salary * 2")).toBeNull();
  expect(parseAssignmentDirective("t.x = 1")).toBeNull();
  expect(parseAssignmentDirective("a, b = 1, 2")).toBeNull();
});

test("markdown parser produces a LuaDirective for an assignment", () => {
  const tree = parse(extendedMarkdownLanguage, "Pay: ${salary = 500}!");
  const directive = findNodeOfType(tree, "LuaDirective");
  expect(directive).toBeTruthy();
  const body = findNodeOfType(directive!, "LuaExpressionDirective")!;
  expect(renderToText(body)).toBe("salary = 500");
  const name = findNodeOfType(body, "LuaAssignmentName")!;
  expect(renderToText(name)).toBe("salary");
  expect(name.from).toBe(7);
});

test("a local assignment gets a LuaAssignmentLocal node", () => {
  const tree = parse(extendedMarkdownLanguage, "${local rate = 0.2}");
  const body = findNodeOfType(tree, "LuaExpressionDirective")!;
  expect(renderToText(findNodeOfType(body, "LuaAssignmentLocal")!)).toBe(
    "local",
  );
  expect(renderToText(findNodeOfType(body, "LuaAssignmentName")!)).toBe("rate");
});

test("only assignments get a LuaAssignmentName node", () => {
  const tree = parse(extendedMarkdownLanguage, "${  rate=0.2} ${a == b}");
  const names = [] as string[];
  for (const d of tree.children![0].children!) {
    const n =
      d.type === "LuaDirective" && findNodeOfType(d, "LuaAssignmentName");
    if (n) names.push(`${renderToText(n)}@${n.from}`);
  }
  expect(names).toEqual(["rate@4"]);
});
