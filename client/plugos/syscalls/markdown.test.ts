// @vitest-environment happy-dom
import { expect, test } from "vitest";
import type { Client } from "../../client.ts";
import { buildTestEnv } from "../../markdown_renderer/compose_test_env.ts";
import { evalExpression } from "../../space_lua/eval.ts";
import { parseExpressionString } from "../../space_lua/parse.ts";
import {
  LuaBuiltinFunction,
  LuaStackFrame,
  type LuaTable,
} from "../../space_lua/runtime.ts";
import { newView } from "../../navigator/view_value.ts";
import { markdownSyscalls } from "./markdown.ts";

async function syscalls() {
  const t = await buildTestEnv();
  const client = {
    space: t.space,
    clientSystem: { spaceLuaEnv: t.sle },
    config: { get: (_k: unknown, d: unknown) => d },
    ui: { viewState: { allPages: [] } },
    currentName: () => "Host",
    currentPageMeta: () => ({ name: "Host" }),
  } as unknown as Client;
  const mapping = markdownSyscalls(client) as Record<string, any>;
  return (name: string, ...args: unknown[]) =>
    mapping[name].callback({} as any, ...args);
}

test("markdownToHtml with expand renders widgets as HTML, not field tables", async () => {
  const s = await syscalls();
  const html = await s("markdown.markdownToHtml", 'a ${T.btn("Go")} ${1+1}', {
    expand: true,
  });
  expect(html).toContain("<button");
  expect(html).toContain("2");
  expect(html).not.toContain("_isWidget");
});

test("expandMarkdown lowers html widgets to raw HTML and keeps markdown", async () => {
  const s = await syscalls();
  const text = await s(
    "markdown.expandMarkdown",
    'x ${T.btn("Go")} ${T.md("**m**")} ${1+1}',
  );
  expect(text).toContain("<button");
  expect(text).toContain("**m**");
  expect(text).toContain("2");
  expect(text).not.toContain("_isWidget");
});

test("renderToDom renders a markdown widget live", async () => {
  const s = await syscalls();
  const node = (await s("markdown.renderToDom", {
    _isWidget: true,
    markdown: "**m** ${1+1}",
  })) as HTMLElement;
  expect(node.querySelector("strong")?.textContent).toBe("m");
  expect(node.textContent).toContain("2");
});

test("expandMarkdown adds task references by default, as documented", async () => {
  const s = await syscalls();
  expect(await s("markdown.expandMarkdown", "* [ ] task")).toContain("[[Host@");
  expect(
    await s("markdown.expandMarkdown", "* [ ] task", { rewriteTasks: false }),
  ).not.toContain("[[Host@");
});

test("markdownToHtml with expand keeps task references", async () => {
  const s = await syscalls();
  const html = await s("markdown.markdownToHtml", "* [ ] task", {
    expand: true,
  });
  expect(html).toContain("Host@");
});

test("expandMarkdown keeps a sandbox widget's markdown as markdown", async () => {
  const s = await syscalls();
  const text = await s(
    "markdown.expandMarkdown",
    '${widget.sandbox { html = "<div></div>", markdown = "**Not** supported" }}',
  );
  expect(text).toBe("**Not** supported");
});

async function withEnv() {
  const t = await buildTestEnv();
  const client = {
    space: t.space,
    clientSystem: { spaceLuaEnv: t.sle },
    config: { get: (_k: unknown, d: unknown) => d },
    ui: { viewState: { allPages: [] } },
    currentName: () => "Host",
    currentPageMeta: () => ({ name: "Host" }),
  } as unknown as Client;
  const mapping = markdownSyscalls(client) as Record<string, any>;
  const lua = (src: string) =>
    evalExpression(
      parseExpressionString(src),
      t.env,
      LuaStackFrame.createWithGlobalEnv(t.env),
    );
  const toMarkdown = async (src: string) =>
    mapping["lua:widget.toMarkdown"].callback({} as any, await lua(src));
  // Exposed the way exposeSyscalls exposes a `lua:` syscall
  await (t.env.get("widget") as LuaTable).set(
    "toMarkdown",
    new LuaBuiltinFunction((sf, w) =>
      mapping["lua:widget.toMarkdown"].callback({ sf }, w),
    ),
    LuaStackFrame.lostFrame,
  );
  return { t, lua, toMarkdown };
}

test("widget.toMarkdown is the value's Copy text", async () => {
  const { toMarkdown } = await withEnv();
  expect(await toMarkdown('widget.markdown("**m**")')).toBe("**m**");
  expect(await toMarkdown('widget.html("<b>x</b>")')).toBe("");
  expect(await toMarkdown('"pre " .. widget.markdown("m") .. " post"')).toBe(
    "pre m post",
  );
  expect(await toMarkdown('widget.live(widget.live("plain", {"edit"}))')).toBe(
    "plain",
  );
  expect(await toMarkdown("{ 1, 2 }")).toBe("");
  expect(
    await toMarkdown(
      'spacelua.interpolate("Hi ${x}", { x = { { name = "a", w = T.md("**b**") } } })',
    ),
  ).toBe("Hi |name|w|\n|--|--|\n|a|**b**|");
});

test("widget.toMarkdown of a list view is its rows, as Copy copies", async () => {
  const { t, lua, toMarkdown } = await withEnv();
  const spec = await lua(
    "{ source = function(ctx) return {{ name = ctx.dock }} end }",
  );
  t.env.set("LIST", newView(spec as LuaTable));
  expect(await toMarkdown("LIST")).toBe("* inline");
  expect(await toMarkdown('"Rows:\\n\\n" .. LIST')).toBe("Rows:\n\n* inline");
});

test("renderToDom applies a widget's classes to the node it returns", async () => {
  const s = await syscalls();
  const node = (await s("markdown.renderToDom", {
    _isWidget: true,
    markdown: "m",
    cssClasses: ["hot"],
  })) as HTMLElement;
  expect(node.classList.contains("hot")).toBe(true);
});

test("a widget that converts itself stops at the nesting limit", async () => {
  const { t, lua } = await withEnv();
  await t.run('T.w = widget.markdown("${widget.toMarkdown(T.w)}")');
  expect(await lua("widget.toMarkdown(T.w)")).toContain(
    "Widget nesting too deep",
  );
});

test("Lua-generated Markdown gets no task reference, even when asked for", async () => {
  const s = await syscalls();
  const text = await s(
    "markdown.expandMarkdown",
    "* [ ] Alpha task\n\n${T.md('* [ ] Beta task')}",
    { rewriteTasks: true },
  );
  expect(text).toContain("* [ ] [[Host@0]] Alpha task");
  expect(text).toContain("* [ ] Beta task");
  expect(text).not.toContain("[[Host@0]] Beta");
  expect(text.match(/\[\[/g)).toHaveLength(1);
});
