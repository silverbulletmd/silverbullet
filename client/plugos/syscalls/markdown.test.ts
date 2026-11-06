// @vitest-environment happy-dom
import { expect, test } from "vitest";
import type { Client } from "../../client.ts";
import {
  buildTestEnv,
  testHost,
} from "../../markdown_renderer/compose_test_env.ts";
import { evalExpression } from "../../space_lua/eval.ts";
import { parseExpressionString } from "../../space_lua/parse.ts";
import {
  LuaBuiltinFunction,
  LuaNativeJSFunction,
  LuaStackFrame,
  type LuaTable,
} from "../../space_lua/runtime.ts";
import { newView } from "../../navigator/view_value.ts";
import { markdownSyscalls } from "./markdown.ts";

async function syscalls() {
  const t = await buildTestEnv();
  const client = {
    space: t.space,
    clientSystem: { spaceLuaEnv: t.sle, pageScopes: testHost(t).pageScopes },
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

test("expandMarkdown evaluates as pageName when given", async () => {
  const s = await syscalls();
  const out = await s(
    "markdown.expandMarkdown",
    "* [ ] task ${_CTX.currentPage.name}",
    {
      pageName: "Other",
    },
  );
  expect(out).toContain("[[Other@");
  expect(out).toContain("task Other");
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
    clientSystem: { spaceLuaEnv: t.sle, pageScopes: testHost(t).pageScopes },
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
  await (t.env.get("widget") as LuaTable).set(
    "markdownSummary",
    new LuaNativeJSFunction((...args) =>
      mapping["widget.markdownSummary"].callback({}, ...args),
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

test("link makes a wiki link to a page, an object or a name", async () => {
  const s = await syscalls();
  expect(s("markdown.link", "Books/Dune")).toBe("[[Books/Dune]]");
  expect(
    s("markdown.link", { tag: "page", name: "Books/Dune", ref: "Books/Dune" }),
  ).toBe("[[Books/Dune]]");
  expect(
    s("markdown.link", { tag: "task", name: "Call Sam", ref: "Work@12" }),
  ).toBe("[[Work@12]]");
  expect(s("markdown.link", "Books/Dune", "Dune")).toBe("[[Books/Dune|Dune]]");
});

test("link of nothing is nothing, so a missing attribute leaves an empty cell", async () => {
  const s = await syscalls();
  expect(s("markdown.link", undefined)).toBeUndefined();
  expect(s("markdown.link", "")).toBeUndefined();
});

test("markdown summaries render inline without running source content", async () => {
  const s = await syscalls();
  const summary = await s(
    "widget.markdownSummary",
    "# **Plan**\n- [notes](../Notes.md) and ${error('private')}\n- `${literal}` [[Page|status ${private}]] #trail",
    { sourcePage: "Projects/Field/Log" },
  );
  const node = (await s("markdown.renderToDom", summary)) as HTMLElement;
  expect(node.textContent).toBe("Plan notes and … ${literal} status … #trail");
  expect(node.querySelector("strong")?.textContent).toBe("Plan");
  expect(node.querySelector("a")?.getAttribute("href")).toBe(
    "/Projects/Notes.md",
  );
  expect(node.querySelector("code")?.textContent?.trim()).toBe("${literal}");
  expect(node.querySelector("h1, ul, li")).toBeNull();
});

test("markdown summaries shorten visible text and sanitize links", async () => {
  const s = await syscalls();
  const summary = await s(
    "widget.markdownSummary",
    "[**é🌱abcdef**](javascript:alert%281%29)",
    { maxChars: 4 },
  );
  const node = (await s("markdown.renderToDom", summary)) as HTMLElement;
  expect(node.textContent).toBe("é🌱a…");
  expect(node.querySelector("strong")?.textContent).toBe("é🌱a");
  expect(node.querySelector("a")?.hasAttribute("href")).toBe(false);
});

test("markdownSummary composes with Lua list rows and hides expression-only excerpts", async () => {
  const { lua } = await withEnv();
  const s = await syscalls();
  const rows = await lua(`table.concat({
    "* [[Field Notes]] " .. widget.markdownSummary("*Fresh* [[#Overview|overview]]", { sourcePage = "Places/Field Notes" }),
    "* [[Log]] " .. widget.markdownSummary([==[\${error("private")}]==]),
  }, "\\n")`);
  const node = (await s("markdown.renderToDom", rows)) as HTMLElement;
  const items = node.querySelectorAll("li");
  expect(items).toHaveLength(2);
  expect(items[0].querySelector("em")?.textContent).toBe("Fresh");
  expect(items[0].querySelectorAll("a")[1].getAttribute("data-ref")).toBe(
    "Places/Field Notes#Overview",
  );
  expect(items[1].textContent?.trim()).toBe("Log");
  const copy = await s("lua:widget.toMarkdown", rows);
  expect(copy).toContain("<em>Fresh</em>");
  expect(copy).not.toContain("private");
});
