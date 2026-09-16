import { expect, test } from "vitest";
import type { Client } from "../client.ts";
import { newView } from "../navigator/view_value.ts";
import { luaHandle } from "../navigator/lua_views.ts";
import { evalExpression } from "./eval.ts";
import { parseExpressionString } from "./parse.ts";
import { LuaEnv, LuaStackFrame, type LuaTable } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import {
  expressionToPortableMarkdown,
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
