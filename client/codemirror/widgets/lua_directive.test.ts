// @vitest-environment happy-dom
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { expect, test } from "vitest";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { directiveWrappers } from "./lua_directive.ts";
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
