// @vitest-environment happy-dom
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { expect, test } from "vitest";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import type { PageScope } from "../../space_lua/page_scope.ts";
import {
  directiveWrappers,
  awaitsPageScope,
  hasPageDefinitions,
} from "./lua_directive.ts";
import { directiveAt } from "./directive_at.ts";
import { wrapInline } from "./lua_widget.ts";

function wrappersFor(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [extendedMarkdownLanguage],
  });
  let found: SyntaxNode | undefined;
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "LuaDirective") found = n.node;
    },
  });
  return directiveWrappers(found!, state, "Host");
}

test("bold, italic, strike and highlight wrap the widget", () => {
  expect(wrappersFor("a **${1}** b").map((w) => w.tag)).toEqual(["strong"]);
  expect(wrappersFor("a ~~*${1}*~~ b").map((w) => w.tag)).toEqual([
    "del",
    "em",
  ]);
  expect(wrappersFor("a ==${1}== b")[0].attrs?.class).toBe("sb-highlight");
});

test("link text keeps its link", () => {
  const [ext] = wrappersFor("[${1}](https://example.com)");
  expect(ext).toMatchObject({
    tag: "a",
    attrs: { href: "https://example.com" },
  });
  const [local] = wrappersFor("[${1}](Other)");
  expect(local.attrs?.["data-ref"]).toBe("Other");
});

test("wrapInline nests outermost first", () => {
  const span = document.createElement("span");
  span.textContent = "2";
  const out = wrapInline(span, [
    { tag: "a", attrs: { href: "#" } },
    { tag: "strong" },
  ]);
  expect(out.outerHTML).toBe('<a href="#"><strong><span>2</span></strong></a>');
});

function stateFor(doc: string) {
  return EditorState.create({ doc, extensions: [extendedMarkdownLanguage] });
}

test("pages with a page-lua block or an assignment have definitions", () => {
  expect(hasPageDefinitions(stateFor("```page-lua\nx = 1\n```\n"))).toBe(true);
  expect(hasPageDefinitions(stateFor("Budget ${salary = 500}"))).toBe(true);
  expect(hasPageDefinitions(stateFor("${1 + 1} and ${a == b}"))).toBe(false);
  expect(hasPageDefinitions(stateFor("```lua\nx = 1\n```\n"))).toBe(false);
});

test("directiveAt names the assignment it is on", () => {
  const state = stateFor("${salary = 500} ${salary == 500}");
  expect(directiveAt(state, 3)?.assignmentName).toBe("salary");
  expect(directiveAt(state, 20)?.assignmentName).toBeUndefined();
});

test("a directive waits for a scope that knows its assignment", () => {
  const scope = {
    key: "Budget#1",
    assignments: new Map([["salary", { value: 500 }]]),
  } as unknown as PageScope;
  // Never built
  expect(awaitsPageScope(undefined, undefined)).toBe(true);
  // A new assignment typed since the last save
  expect(awaitsPageScope(scope, "increase")).toBe(true);
  expect(awaitsPageScope(null, "increase")).toBe(true);
  expect(awaitsPageScope(scope, "salary")).toBe(false);
  expect(awaitsPageScope(scope, undefined)).toBe(false);
  expect(awaitsPageScope(null, undefined)).toBe(false);
});
