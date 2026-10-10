// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { isDomNode } from "../lib/dom.ts";
import { classifyResult } from "../space_lua/render_lua_markdown.ts";
import { LuaEnv, LuaTable } from "../space_lua/runtime.ts";
import { slotMarker } from "./slots.ts";
import { planValue as planWith } from "./value_plan.ts";

const env = new LuaEnv();
const planValue = (v: unknown) => planWith(v, () => {}, env);

const btn = { _isWidget: true, html: "<button>b</button>" };

test("strings and scalar lists keep today's markdown", () => {
  expect(planValue("**x**")).toMatchObject({
    kind: "markdown",
    markdown: "**x**",
    slots: [],
  });
  const list = planValue(new LuaTable(["* a\n", "* b\n"]));
  expect(list).toMatchObject({ kind: "markdown", markdown: "* a\n\n* b\n" });
});

test("a list of widgets is a content list, not a record table", () => {
  expect(classifyResult([btn, btn]).kind).toBe("contentList");
  expect(
    classifyResult(new LuaTable([new LuaTable({ _isWidget: true, html: "x" })]))
      .kind,
  ).toBe("contentList");
  const plan = planValue([btn, "text", btn]);
  expect(plan).toMatchObject({
    kind: "markdown",
    markdown: `${slotMarker(0)}\ntext\n${slotMarker(1)}`,
  });
});

test("records with widget cells get slot cells; scalar cells unchanged", () => {
  const plan = planValue([{ name: "a", action: btn }]) as any;
  expect(plan.kind).toBe("markdown");
  expect(plan.markdown).toContain(slotMarker(0));
  expect(plan.markdown).toContain("<td");
  expect(plan.markdown).toContain('data-table-cell-type="string">a</td>');
  expect(plan.slots[0]).toBe(btn);
});

test("fragments flatten to one markdown string with markers", () => {
  const frag = { _isWidget: true, parts: ["* ", btn, "\n* next"] };
  expect(planValue(frag)).toMatchObject({
    kind: "markdown",
    markdown: `* ${slotMarker(0)}\n* next`,
  });
});

test("widget kinds", () => {
  expect(
    planValue({
      _isWidget: true,
      html: "<b>x</b>",
      display: "block",
      markdown: "x",
    }),
  ).toMatchObject({ kind: "html", block: true, copyMarkdown: "x" });
  expect(
    planValue({ _isWidget: true, markdown: "m", evaluate: false }),
  ).toMatchObject({ kind: "literal" });
  expect(planValue({ _isWidget: true, sandbox: true, html: "x" }).kind).toBe(
    "sandbox",
  );
  expect(planValue(null).kind).toBe("empty");
});

test("block detection", () => {
  expect((planValue("inline") as any).block).toBeFalsy();
  expect((planValue("* a\n* b") as any).block).toBe(true);
  expect((planValue({ _isWidget: true, html: "x" }) as any).block).toBe(false);
  expect((planValue([{ a: 1 }]) as any).block).toBe(true);
});

test("1000 widget rows plan into one markdown document", () => {
  const plan = planValue(Array.from({ length: 1000 }, () => btn)) as any;
  expect(plan.kind).toBe("markdown");
  expect(plan.slots).toHaveLength(1000);
  expect(plan.markdown.split("\n")).toHaveLength(1000);
});

test("a string holding a rendered table is block content, like a query", () => {
  expect((planValue("<table><tr><td>x</td></tr></table>") as any).block).toBe(
    true,
  );
});

test("a live wrapper renders as its value", () => {
  expect(
    planValue({
      _isWidget: true,
      live: { value: "**x**", refreshOn: ["index"] },
    }),
  ).toEqual(planValue("**x**"));
});

test("a bare DOM node plans as html", () => {
  const b = document.createElement("button");
  expect(isDomNode(b)).toBe(true);
  expect(isDomNode("x")).toBe(false);
  expect(planValue(b)).toEqual({
    kind: "html",
    html: b,
    block: false,
    copyMarkdown: "",
  });
});
