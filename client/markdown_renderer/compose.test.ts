// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import {
  bakeMarkdown,
  createRenderContext,
  disposeRendered,
  expandMarkdownStatic,
  MAX_RENDER_DEPTH,
  portableMarkdown,
  renderMarkdown,
  renderMarkdownStatic,
  renderValue,
} from "./compose.ts";
import { evalExpression } from "../space_lua/eval.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import {
  LuaStackFrame,
  type LuaTable,
  luaValueToJS,
} from "../space_lua/runtime.ts";
import { newView } from "../navigator/view_value.ts";
import { makeFragment } from "../space_lua/fragment.ts";
import { buildTestEnv, normaliseLive, testHost } from "./compose_test_env.ts";

async function evalLua(
  t: Awaited<ReturnType<typeof buildTestEnv>>,
  src: string,
) {
  return evalExpression(
    parseExpressionString(src),
    t.env,
    LuaStackFrame.createWithGlobalEnv(t.env),
  );
}

async function live(md: string, pages: Record<string, string> = {}) {
  const t = await buildTestEnv(pages);
  const ctx = createRenderContext(testHost(t), {
    hostPage: { name: "Host" },
  });
  return { t, r: await renderMarkdown(md, ctx) };
}

test("html widgets render as real DOM with working listeners", async () => {
  const { t, r } = await live('a ${T.btn("Go")} b');
  const button = r.node.querySelector("button")!;
  expect(button.textContent).toBe("Go");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((t.env.get("T") as any).rawGet("clicked")).toBe("Go");
  expect(r.node.querySelector("table")).toBeNull();
});

test("nesting works at depth 3 and stops at the cap", async () => {
  const { r } = await live("${T.md(\"L2 ${T.md('L3 ${1+2}')}\")}");
  expect(r.node.textContent).toContain("L2 L3 3");
  // Each level wraps the previous source in T.md(…); JSON quoting is valid Lua here.
  let src = "${1+1}";
  for (let i = 0; i <= MAX_RENDER_DEPTH; i++) {
    src = `\${T.md(${JSON.stringify(src)})}`;
  }
  const { r: r2 } = await live(src);
  expect(r2.node.textContent).toContain("Widget nesting too deep (8)");
});

test("_CTX.currentPage is the host page; sourcePage follows transclusions", async () => {
  const { r } = await live("![[Inc]]", {
    Inc: "${_CTX.currentPage.name}/${_CTX.sourcePage.name}",
  });
  expect(r.node.textContent).toContain("Host/Inc");
});

test("widgets and pipes inside table cells", async () => {
  const { r } = await live(
    'x\n\n| a | b |\n|---|---|\n| ${T.btn("Cell")} | ${"a|b"} |',
  );
  const cells = r.node.querySelectorAll("tr")[1].querySelectorAll("td");
  expect(cells).toHaveLength(2);
  expect(cells[0].querySelector("button")?.textContent).toBe("Cell");
  expect(cells[1].textContent).toBe("a|b");
});

test("the same DOM node used twice renders twice", async () => {
  const t = await buildTestEnv();
  await t.run('T.one = T.btn("Once")');
  const ctx = createRenderContext(testHost(t), {
    hostPage: { name: "Host" },
  });
  const r = await renderMarkdown("${T.one} ${T.one}", ctx);
  expect(r.node.querySelectorAll("button")).toHaveLength(2);
});

test("a stray marker without a slot renders as its original text", async () => {
  const { r } = await live("a ￼3￼ b");
  expect(r.node.textContent).toContain("￼3￼");
});

test("static rendering lowers widgets to HTML without listeners", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), {
    hostPage: { name: "Host" },
  });
  const r = await renderMarkdownStatic(
    'a ${T.btn("Go")} ${T.md("**m** ${1+1}")}',
    ctx,
  );
  expect(r).toContain("<button");
  expect(r).toContain("<strong>m</strong>");
  expect(r.replace(/<[^>]+>/g, "")).toContain("m 2");
  expect(r).not.toContain("_isWidget");
});

test("copy markdown substitutes nested results", async () => {
  const { r } = await live('A ${T.md("b ${1+1}")}');
  expect(r.copyMarkdown).toBe("A b 2");
});

test("one shared budget: later directives report stopped", async () => {
  const t = await buildTestEnv();
  await t.run("function T.spin() local i = 0 while true do i = i + 1 end end");
  const ctx = createRenderContext(testHost(t), {
    hostPage: { name: "Host" },
  });
  ctx.budget.busyLimitMs = 20;
  const r = await renderMarkdown("${T.spin()} ${T.spin()}", ctx);
  expect(r.node.textContent).toContain("Lua timeout");
  expect(r.node.textContent).toContain("stopped");
});

test("aliases and attribute values evaluate for display", async () => {
  const { r } = await live("See [[Alpha|n=${1+1}]] and [k: ${2+3}]");
  expect(r.node.querySelector("a.wiki-link")?.textContent).toBe("n=2");
  const attr = r.node.querySelector(".sb-attribute")!;
  expect(attr.textContent).toContain("5");
  expect(attr.getAttribute("data-k")).toBe("${2+3}");
});

test("idle time before a directive isn't billed to the Lua budget", async () => {
  const t = await buildTestEnv();
  await t.run(
    "function T.loop() local n = 0 for i = 1, 200000 do n = n + 1 end return n end",
  );
  const ctx = createRenderContext(testHost(t), {
    hostPage: { name: "Host" },
  });
  // As if transclusion reads and parsing had taken 5s before this directive ran
  ctx.budget.lastCheck -= 5000;
  const r = await renderMarkdown("${T.loop()}", ctx);
  expect(r.node.textContent).toContain("200000");
});

test("sibling widgets can each transclude the same page", async () => {
  const { r } = await live(
    '${T.md("![[Card]]")} / ${T.md("![[Card]]")} / ${ {T.md("![[Card]]"), T.md("![[Card]]")} }',
    { Card: "CARD" },
  );
  expect(r.node.textContent?.match(/CARD/g)).toHaveLength(4);
  expect(r.node.textContent).not.toContain("![[Card]]");
});

test("a page transcluding itself is still stopped", async () => {
  const { r } = await live("![[Loop]]", { Loop: "L ![[Loop]]" });
  expect(r.node.textContent?.match(/L/g)?.length).toBeLessThan(4);
});

test("raw marker text never resolves to a directive's or fragment's slot", async () => {
  const { r } = await live('a \uFFFC0\uFFFC b ${T.btn("X")}');
  expect(r.node.querySelectorAll("button")).toHaveLength(1);
  const { r: r2 } = await live('${T.btn("Y") .. " \uFFFC0\uFFFC"}');
  expect(r2.node.querySelectorAll("button")).toHaveLength(1);
});

test("a page template can still emit a literal directive", async () => {
  const t = await buildTestEnv();
  await t.run(
    'RESULT = template.new([==[# Interviews\n${"$" .. "{hiring.interviews()}"}]==])()',
  );
  expect(t.env.get("RESULT")).toBe("# Interviews\n${hiring.interviews()}");
});

test("a template renders a query result as the page would, as a string", async () => {
  const t = await buildTestEnv();
  await t.run(
    "RESULT = template.new[==[${query[[from r = T.records select {name=r.name, n=r.n}]]}]==]()",
  );
  const result = t.env.get("RESULT");
  expect(typeof result).toBe("string");
  expect(result).toContain("<table");
  expect(result).not.toContain("{");
  await t.run('LIST = template.new[==[${ {"x", "y"} }]==]()');
  // One item per line, as a page-level ${ {"x", "y"} } renders
  expect(t.env.get("LIST")).toBe("x\ny");
});

test("renderValue reports the plan kind it rendered", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  expect((await renderValue("hi", ctx)).kind).toBe("markdown");
  expect((await renderValue(null, ctx)).kind).toBe("empty");
  expect(
    (
      await renderValue(
        { _isWidget: true, sandbox: true, html: "<b>x</b>" },
        ctx,
      )
    ).kind,
  ).toBe("sandbox");
});

test("portableMarkdown: one text for Copy and Bake", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const md = (v: unknown) => portableMarkdown(v, ctx);
  expect(await md("**hi**")).toEqual({ ok: true, markdown: "**hi**" });
  expect(await md(42)).toEqual({ ok: true, markdown: "42" });
  expect(await md(null)).toEqual({ ok: true, markdown: "" });
  const fragment = await evalLua(t, '"Status: " .. T.md("**ok**")');
  expect(await md(fragment)).toEqual({
    ok: true,
    markdown: "Status: **ok**",
  });
  expect(await md({ _isWidget: true, html: "<b>x</b>" })).toMatchObject({
    ok: false,
  });
  expect(
    await md({ _isWidget: true, html: "<b>x</b>", markdown: "**x**" }),
  ).toEqual({ ok: true, markdown: "**x**" });
  const table = await md([{ name: "Alpha task", n: 1 }]);
  expect(table.ok && table.markdown).toContain("|name|n|");
});

test("widget.live(x) copies and bakes exactly like x", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  for (const src of [
    "T.records",
    '"**hi**"',
    'T.md("**m**")',
    '{ { name = "Alpha task", status = T.md("*open*") } }',
  ]) {
    const plain = await portableMarkdown(await evalLua(t, src), ctx);
    const lua = await evalLua(t, `widget.live(${src})`);
    expect(await portableMarkdown(lua, ctx)).toEqual(plain);
    // The top-level shape LuaWidget gets: widgets are converted to JS
    const js = luaValueToJS(lua, LuaStackFrame.lostFrame);
    expect(await portableMarkdown(js, ctx)).toEqual(plain);
    expect((await renderValue(js, ctx)).copyMarkdown).toBe(
      (await renderValue(await evalLua(t, src), ctx)).copyMarkdown,
    );
  }
});

test("a widget.live in a table cell copies its content", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const r = await portableMarkdown(
    await evalLua(
      t,
      '{ { name = "Alpha task", status = widget.live(T.md("*open*")) } }',
    ),
    ctx,
  );
  expect(r.ok && r.markdown).toContain("*open*");
});

test("a bare DOM node renders like widget.html, listeners kept", async () => {
  const t = await buildTestEnv();
  await t.run(
    'clicked = false; function mk() local b = js.window.document.createElement("button"); b.textContent = "Go"; b.addEventListener("click", function() clicked = true end); return b end',
  );
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const r = await renderMarkdown("${mk()}", ctx);
  r.node.querySelector("button")!.click();
  await new Promise((res) => setTimeout(res, 0));
  expect(t.env.get("clicked")).toBe(true);
});

test("a bare DOM node in a table cell is mounted with its listeners", async () => {
  const t = await buildTestEnv();
  await t.run(
    'cellClicked = false; function mk() local b = js.window.document.createElement("button"); b.textContent = "Go"; b.addEventListener("click", function() cellClicked = true end); return b end',
  );
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const r = await renderMarkdown(
    '${{ { name = "Alpha task", act = mk() } }}',
    ctx,
  );
  const button = r.node.querySelector("td button") as HTMLElement;
  expect(button.textContent).toBe("Go");
  button.click();
  await new Promise((res) => setTimeout(res, 0));
  expect(t.env.get("cellClicked")).toBe(true);
});

const QUERY_IN_FRAGMENT =
  'spacelua.interpolate("Hi ${x}", { x = { { name = "a", w = T.md("**b**") } } })';
const GFM = "|name|w|\n|--|--|\n|a|**b**|";

test("a fragment holding a query result copies as clean GFM on every path", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const value = await evalLua(t, QUERY_IN_FRAGMENT);
  expect(await portableMarkdown(value, ctx)).toEqual({
    ok: true,
    markdown: `Hi ${GFM}`,
  });
  expect((await renderValue(value, ctx)).copyMarkdown).toBe(`Hi ${GFM}`);
  // The same table on its own copies the same GFM
  const plain = await evalLua(t, '{ { name = "a", w = T.md("**b**") } }');
  expect(await portableMarkdown(plain, ctx)).toEqual({
    ok: true,
    markdown: GFM,
  });
  // …and a table cell holding the fragment keeps its row on one line
  const cell = await evalLua(t, `{ { c = ${QUERY_IN_FRAGMENT} } }`);
  expect(await portableMarkdown(cell, ctx)).toEqual({
    ok: true,
    markdown: "|c|\n|--|\n|Hi \\|name\\|w\\| \\|--\\|--\\| \\|a\\|**b**\\||",
  });
});

test("a multi-line widget in a table cell copies on one line", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const value = await evalLua(
    t,
    '{ { name = "Alpha task", notes = T.md("first\\nsecond") } }',
  );
  const expected = "|name|notes|\n|--|--|\n|Alpha task|first second|";
  expect(await portableMarkdown(value, ctx)).toEqual({
    ok: true,
    markdown: expected,
  });
  expect((await renderValue(value, ctx)).copyMarkdown).toBe(expected);
});

test("evaluate = false copies, bakes and expands as its Markdown", async () => {
  const t = await buildTestEnv();
  await t.run('T.lit = widget.markdown("**x** ${1+1}", { evaluate = false })');
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const lit = await evalLua(t, "T.lit");
  expect(await portableMarkdown(lit, ctx)).toEqual({
    ok: true,
    markdown: "**x** ${1+1}",
  });
  const tree = await expandMarkdownStatic(
    parse(extendedMarkdownLanguage, "${T.lit}"),
    ctx,
  );
  expect(renderToText(tree)).toBe("**x** ${1+1}");
});

test("bakeable says whether a value has Markdown to bake", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const portable = async (v: unknown) => (await renderValue(v, ctx)).bakeable;
  expect(await portable("x")).toBe(true);
  expect(await portable(null)).toBe(true);
  expect(await portable({ _isWidget: true, html: "<b>x</b>" })).toBe(false);
  expect(
    await portable({ _isWidget: true, html: "<b>x</b>", markdown: "**x**" }),
  ).toBe(true);
  expect(
    await portable({ _isWidget: true, sandbox: true, html: "<i>s</i>" }),
  ).toBe(false);
});

test("a task in a transcluded section is referenced at its offset in the page", async () => {
  const t = await buildTestEnv();
  const space = {
    readRef: async () => ({ text: "* [ ] Alpha task", offset: 20 }),
  } as unknown as typeof t.space;
  const ctx = createRenderContext(testHost(t, { space }), {
    hostPage: { name: "Host" },
  });
  expect(
    await portableMarkdown(
      { _isWidget: true, markdown: "![[Projects/Sketchbook#Todo]]" },
      ctx,
    ),
  ).toEqual({
    ok: true,
    markdown: "* [ ] [[Projects/Sketchbook@20]] Alpha task",
  });
});

test("renderValue reports the top-level chrome instead of applying it", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const click = vi.fn();
  const r = await renderValue(
    { _isWidget: true, markdown: "hi", cssClasses: ["hot"], events: { click } },
    ctx,
  );
  expect(r.chrome).toEqual({ cssClasses: ["hot"], events: { click } });
  expect(r.node.classList.contains("hot")).toBe(false);
  expect(r.fromWidget).toBe(true);
  const live = await renderValue(
    {
      _isWidget: true,
      live: {
        value: { _isWidget: true, markdown: "x", cssClasses: ["warm"] },
        refreshOn: ["index"],
      },
    },
    ctx,
  );
  expect(live.chrome.cssClasses).toEqual(["warm"]);
  expect((await renderValue("plain", ctx)).fromWidget).toBe(false);
  expect((await renderValue([{ a: 1 }], ctx)).fromWidget).toBe(false);
  expect((await renderValue({ _isWidget: true }, ctx)).fromWidget).toBe(true);
});

test("nested widgets still get their chrome", async () => {
  const { r } = await live(
    'a ${widget.new { markdown = "b", cssClasses = { "hot" } }}',
  );
  expect(r.node.querySelector(".hot")?.textContent).toBe("b");
});

test("widget.live(x) renders exactly like x, floats and mixed tables included", async () => {
  for (const x of ["2.0", "{ 1, 2, x = 3 }", '"a " .. widget.live(2.0)']) {
    const { r: plain } = await live(`\${${x}}`);
    const { r: wrapped } = await live(`\${widget.live(${x})}`);
    expect(normaliseLive(wrapped.node)).toBe(normaliseLive(plain.node));
    expect(wrapped.copyMarkdown).toBe(plain.copyMarkdown);
  }
  const { r } = await live("${widget.live(2.0)}");
  expect(r.node.textContent).toBe("2.0");
});

test("renderValue reports the triggers of every widget.live it rendered", async () => {
  const t = await buildTestEnv();
  const triggers = async (src: string) =>
    (
      await renderValue(
        await evalLua(t, src),
        createRenderContext(testHost(t), { hostPage: { name: "Host" } }),
      )
    ).live?.sort();
  expect(
    await triggers(
      '"Open: " .. widget.live(3) .. " / " .. widget.live(4, { "index", "edit" })',
    ),
  ).toEqual(["edit", "index"]);
  expect(await triggers("{ { cell = widget.live(1) } }")).toEqual(["index"]);
  expect(await triggers('"plain"')).toBeUndefined();
  expect(await triggers("widget.live(1, {})")).toBeUndefined();
});

test("disposeRendered disposes a top-level view node too", async () => {
  const t = await buildTestEnv();
  const unmount = vi.fn();
  const ctx = createRenderContext(testHost(t, { mountView: () => unmount }), {
    hostPage: { name: "Host" },
  });
  const spec = await evalLua(t, "{ source = function() return {} end }");
  const r = await renderValue(newView(spec as LuaTable), ctx);
  disposeRendered(r.node);
  expect(unmount).toHaveBeenCalledOnce();
});

test("a list view copies as its rows but isn't baked; rendering doesn't read them", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const view = async (src: string) =>
    newView((await evalLua(t, src)) as LuaTable);
  const list = await view(
    "{ source = function(ctx) return {{ name = ctx.dock }} end }",
  );
  expect(await portableMarkdown(list, ctx)).toEqual({
    ok: true,
    markdown: "* inline",
  });
  expect(
    await portableMarkdown(makeFragment(["Rows:\n\n", list]), ctx),
  ).toEqual({ ok: true, markdown: "Rows:\n\n* inline" });
  expect(await bakeMarkdown(list, ctx)).toEqual({
    ok: false,
    reason: "A view has no portable Markdown rendering",
  });
  const content = await view('{ content = function() return "x" end }');
  expect(await portableMarkdown(content, ctx)).toEqual({
    ok: false,
    reason: "A view has no portable Markdown rendering",
  });

  const viewMarkdown = vi.fn();
  const spied = createRenderContext(testHost(t, { viewMarkdown }), {
    hostPage: { name: "Host" },
  });
  expect(await renderValue(list, spied)).toMatchObject({
    bakeable: false,
    copyable: true,
  });
  expect(viewMarkdown).not.toHaveBeenCalled();
  expect(await renderValue(content, spied)).toMatchObject({
    bakeable: false,
    copyable: false,
  });
  const noRows = createRenderContext(testHost(t, { viewMarkdown: undefined }), {
    hostPage: { name: "Host" },
  });
  expect((await renderValue(list, noRows)).copyable).toBe(false);
});

test("copyable: Markdown with text to copy", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const copyable = async (v: unknown) => (await renderValue(v, ctx)).copyable;
  expect(await copyable("x")).toBe(true);
  expect(await copyable("")).toBe(false);
  expect(await copyable({ _isWidget: true, html: "<b>x</b>" })).toBe(false);
});

test("static expansion and rendering never read a view's rows", async () => {
  const t = await buildTestEnv();
  const spec = await evalLua(t, "{ source = function() return {} end }");
  t.env.set("LIST", newView(spec as LuaTable));
  const viewMarkdown = vi.fn();
  const ctx = createRenderContext(testHost(t, { viewMarkdown }), {
    hostPage: { name: "Host" },
  });
  const src = '${LIST} ${"x " .. LIST} ${{ { name = "a", v = LIST } }}';
  await expandMarkdownStatic(parse(extendedMarkdownLanguage, src), ctx);
  await renderMarkdownStatic(src, ctx);
  await renderValue(makeFragment(["x ", t.env.get("LIST")]), ctx);
  expect(viewMarkdown).not.toHaveBeenCalled();
});

test("a view bakes as nothing at any depth; Copy takes its rows", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const list = newView(
    (await evalLua(
      t,
      "{ source = function(ctx) return {{ name = ctx.dock }} end }",
    )) as LuaTable,
  );
  const nested = makeFragment(["Rows:\n\n", list]);
  expect(await bakeMarkdown(nested, ctx)).toEqual({
    ok: true,
    markdown: "Rows:",
  });
  const table = [{ name: "a", v: list }];
  const copied = await portableMarkdown(table, ctx);
  const baked = await bakeMarkdown(table, ctx);
  expect(copied.ok && copied.markdown).toContain("* inline");
  expect(baked.ok && baked.markdown).toContain("|a|");
  expect(baked.ok && baked.markdown).not.toContain("inline");
});

test("a fragment whose only content is a list view offers Copy", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const list = newView(
    (await evalLua(t, "{ source = function() return {} end }")) as LuaTable,
  );
  expect(await renderValue(makeFragment([list]), ctx)).toMatchObject({
    copyable: true,
    bakeable: true,
  });
  expect(await renderValue([{ v: list }], ctx)).toMatchObject({
    copyable: true,
  });
});
