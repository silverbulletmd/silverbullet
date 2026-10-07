import { expect, test, vi } from "vitest";
import type { Client } from "../client.ts";
import { newView } from "../navigator/view_value.ts";
import { luaHandle } from "../navigator/lua_views.ts";
import { evalExpression } from "./eval.ts";
import { parseExpressionString } from "./parse.ts";
import { LuaEnv, LuaStackFrame, type LuaTable } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import {
  expressionToPortableMarkdown,
  isLuaWidgetError,
  renderLuaExpression,
} from "./render_widget.ts";
import { expandMarkdown } from "../markdown_renderer/inline.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { renderToText } from "../../plug-api/lib/tree.ts";
import type { SpaceLuaEnvironment } from "../space_lua.ts";
import type { Space } from "../space.ts";

function fixture() {
  const env = new LuaEnv(luaBuildStandardEnv());
  const spec = evalExpression(
    parseExpressionString(
      "{ source = function(ctx) return {{ name = ctx.dock }} end }",
    ),
    env,
    new LuaStackFrame(env, null),
  ) as LuaTable;
  const value = newView(spec);
  env.setLocal("sample", value);
  const client = {
    clientSystem: { spaceLuaEnv: { env } },
    ui: { viewState: { current: { path: "Workshop.md" } } },
  } as unknown as Client;
  return { client, value, env };
}

test("expression rendering preserves a view's live source callback", async () => {
  const { client, value, env } = fixture();
  const rendered = await renderLuaExpression(client, "sample");
  expect(rendered).toBe(value);
  const rows = await luaHandle(
    rendered.spec,
    "rows",
    { ctx: { dock: "inline" } },
    env,
  );
  expect(rows[0].primary).toBe("inline");
});

test("baking a view reports unsupported output instead of serializing its table", async () => {
  const { client } = fixture();
  const result = await expressionToPortableMarkdown(client, "sample");
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatch(/view.*markdown/i);
});

test("static Markdown expansion does not serialize view internals", async () => {
  const { env } = fixture();
  const tree = await expandMarkdown(
    {} as Space,
    "Workshop",
    parse(extendedMarkdownLanguage, "${sample}"),
    { env } as SpaceLuaEnvironment,
  );
  expect(renderToText(tree)).toContain("view");
  expect(renderToText(tree)).not.toContain("<table");
});

test("a failing widget logs one line naming the page, and keeps its visible text", async () => {
  const { client } = fixture();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const rendered = await renderLuaExpression(client, "nosuch.field");
    expect(typeof rendered).toBe("string");
    expect(rendered).toMatch(/^\*\*Lua error:\*\* /);
    expect(isLuaWidgetError(rendered)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toHaveLength(1);
    const line = spy.mock.calls[0][0] as string;
    expect(line).toMatch(/^Lua widget error on Workshop: /);
    expect(line).toContain("nosuch");
    expect(line).not.toContain("\n");
  } finally {
    spy.mockRestore();
  }
});

test("a widget error uses an explicit page name when given", async () => {
  const { client } = fixture();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await renderLuaExpression(client, "nosuch.field", { name: "Notes/Day" });
    expect(spy.mock.calls[0][0]).toMatch(/^Lua widget error on Notes\/Day: /);
  } finally {
    spy.mockRestore();
  }
});

test("isLuaWidgetError only matches rendered failures", () => {
  expect(isLuaWidgetError("**Lua error:** boom")).toBe(true);
  expect(isLuaWidgetError("**Lua timeout:** slow")).toBe(true);
  expect(isLuaWidgetError("**Error:** Empty Lua expression")).toBe(true);
  expect(isLuaWidgetError("all good")).toBe(false);
  expect(isLuaWidgetError(42)).toBe(false);
  expect(isLuaWidgetError(null)).toBe(false);
});
