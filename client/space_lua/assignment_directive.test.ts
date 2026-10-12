import { expect, test } from "vitest";
import { parseAssignmentDirective } from "./assignment_directive.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import {
  findNodeOfType,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";

test("recognises name = expr", () => {
  expect(parseAssignmentDirective("salary = 500")).toEqual({
    name: "salary",
    nameOffset: 0,
    exprSource: " 500",
    exprOffset: 8,
  });
  expect(parseAssignmentDirective("  rate=0.2")?.name).toBe("rate");
});

test("ignores comparisons and non-assignments", () => {
  expect(parseAssignmentDirective("a == b")).toBeNull();
  expect(parseAssignmentDirective("salary * 2")).toBeNull();
  expect(parseAssignmentDirective("t.x = 1")).toBeNull();
  expect(parseAssignmentDirective("local x = 1")).toBeNull();
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
