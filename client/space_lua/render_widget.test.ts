// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import type { Client } from "../client.ts";
import { newView } from "../navigator/view_value.ts";
import { luaHandle } from "../navigator/lua_views.ts";
import { evalExpression } from "./eval.ts";
import { parseExpressionString } from "./parse.ts";
import { LuaEnv, LuaStackFrame, type LuaTable } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import { isLuaWidgetError, renderLuaExpression } from "./render_widget.ts";
import {
  createRenderContext,
  expandMarkdownStatic,
  applyChrome,
  type RenderHost,
  renderValue,
} from "../markdown_renderer/compose.ts";
import {
  buildTestEnv,
  testHost,
} from "../markdown_renderer/compose_test_env.ts";
import { expressionToPortableMarkdown } from "../markdown_renderer/compose_client.ts";
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
    ui: { viewState: { current: { path: "Workshop.md" }, allPages: [] } },
    currentPageMeta: () => ({ name: "Workshop" }),
    currentName: () => "Workshop",
    config: { get: (_k: string, d: unknown) => d },
    space: {},
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

test("Baked Sections: Update bakes a nested view as nothing", async () => {
  const { client } = fixture();
  expect(
    await expressionToPortableMarkdown(client, '"Rows:\\n\\n" .. sample'),
  ).toEqual({ ok: true, markdown: "Rows:" });
});

test("static Markdown expansion does not serialize view internals", async () => {
  const { env } = fixture();
  const host = {
    space: {} as Space,
    sle: { env } as SpaceLuaEnvironment,
    syntaxExtensions: {},
    allPages: [],
    renderOptions: {},
  } as RenderHost;
  const tree = await expandMarkdownStatic(
    parse(extendedMarkdownLanguage, "${sample}"),
    createRenderContext(host, { hostPage: { name: "Workshop" } }),
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

test("a directive with a Lua syntax error renders a visible error", async () => {
  const { client } = fixture();
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const rendered = await renderLuaExpression(
      client,
      'f { a { "x" } a { "y" } }',
    );
    expect(typeof rendered).toBe("string");
    expect(rendered).toMatch(/^\*\*Lua error:\*\* /);
    expect(isLuaWidgetError(rendered)).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

test("a top-level widget.live keeps its value's Lua shape through evaluation", async () => {
  const t = await buildTestEnv();
  const client = {
    clientSystem: { spaceLuaEnv: { env: t.env } },
    ui: { viewState: { current: { path: "Workshop.md" } } },
  } as unknown as Client;
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const r = await renderValue(
    await renderLuaExpression(client, "widget.live(2.0)"),
    ctx,
  );
  expect(r.node.textContent).toBe("2.0");
  expect(r.live).toEqual(["index"]);
});

async function renderExpr(src: string) {
  const t = await buildTestEnv();
  const client = {
    clientSystem: { spaceLuaEnv: { env: t.env } },
    ui: { viewState: { current: { path: "Workshop.md" } } },
  } as unknown as Client;
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  return {
    t,
    r: await renderValue(await renderLuaExpression(client, src), ctx),
  };
}

test("widget event handlers run with the global environment, top-level and nested", async () => {
  const button =
    'widget.new { html = "<button>Go</button>", events = { click = function() T.got = ("hi"):upper() end } }';
  for (const src of [button, `{ ${button} }`]) {
    const { t, r } = await renderExpr(src);
    applyChrome(r.node, r.chrome);
    document.body.append(r.node);
    r.node.querySelector("button")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    r.node.remove();
    expect((t.env.get("T") as LuaTable).rawGet("got")).toBe("HI");
  }
});

test("a widget.live in a top-level list makes the expression live", async () => {
  const { r } = await renderExpr("{ widget.live(1), 2 }");
  expect(r.live).toEqual(["index"]);
});

test("a self-referencing widget.live stops instead of recursing forever", async () => {
  const { r } = await renderExpr(
    "(function() local w = widget.live(1); w.live.value = w; return w end)()",
  );
  expect(r.node.textContent).toContain("nesting too deep");
  expect(r.live).toEqual(["index"]);
});
