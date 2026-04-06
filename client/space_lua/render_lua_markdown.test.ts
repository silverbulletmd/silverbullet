import { expect, test } from "vitest";
import { renderResultToMarkdown } from "./render_lua_markdown.ts";
import { LuaTable } from "./runtime.ts";
import { makeLuaFloat } from "./numeric.ts";
import { LIQ_NULL } from "./liq_null.ts";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";

// Helper: render a value all the way to final HTML.
function toHtml(value: any): string {
  const { markdown } = renderResultToMarkdown(value);
  const tree = parse(extendedMarkdownLanguage, markdown);
  return renderMarkdownToHtml(tree, {});
}

// ── Nil / empty values ──────────────────────────────────────────────

test("null renders as empty markdown with dataType nil", async () => {
  const r = renderResultToMarkdown(null);
  expect(r).toEqual({ markdown: "", dataType: "nil" });
});

test("undefined renders as empty markdown with dataType nil", async () => {
  const r = renderResultToMarkdown(undefined);
  expect(r).toEqual({ markdown: "", dataType: "nil" });
});

test("LIQ_NULL (SQL NULL) renders as empty markdown with dataType nil", async () => {
  const r = renderResultToMarkdown(LIQ_NULL);
  expect(r).toEqual({ markdown: "", dataType: "nil" });
});

// ── Strings ─────────────────────────────────────────────────────────

test("string is returned as raw markdown", async () => {
  const r = renderResultToMarkdown("hello world");
  expect(r).toEqual({ markdown: "hello world", dataType: "string" });
});

test("empty string is rendered (not treated as nil)", async () => {
  const r = renderResultToMarkdown("");
  expect(r).toEqual({ markdown: "", dataType: "string" });
});

test("string with wiki link syntax is preserved as-is", async () => {
  const r = renderResultToMarkdown("see [[MyPage]]");
  expect(r).toEqual({ markdown: "see [[MyPage]]", dataType: "string" });
});

test("string with bold syntax is preserved as-is", async () => {
  const r = renderResultToMarkdown("hello **world**");
  expect(r).toEqual({ markdown: "hello **world**", dataType: "string" });
});

test("string with HTML is not escaped (raw markdown)", async () => {
  const r = renderResultToMarkdown('<b>"Tom & Jerry"</b>');
  expect(r).toEqual({
    markdown: '<b>"Tom & Jerry"</b>',
    dataType: "string",
  });
});

// ── Numbers ─────────────────────────────────────────────────────────

test("integer number", async () => {
  const r = renderResultToMarkdown(42);
  expect(r).toEqual({ markdown: "42", dataType: "number" });
});

test("zero", async () => {
  const r = renderResultToMarkdown(0);
  expect(r).toEqual({ markdown: "0", dataType: "number" });
});

test("non-integer float", async () => {
  const r = renderResultToMarkdown(1.5);
  expect(r).toEqual({ markdown: "1.5", dataType: "number" });
});

test("tagged float (integer-valued)", async () => {
  const r = renderResultToMarkdown(makeLuaFloat(2));
  expect(r).toEqual({ markdown: "2.0", dataType: "number" });
});

// ── Booleans ────────────────────────────────────────────────────────

test("boolean true", async () => {
  const r = renderResultToMarkdown(true);
  expect(r).toEqual({ markdown: "true", dataType: "boolean" });
});

test("boolean false", async () => {
  const r = renderResultToMarkdown(false);
  expect(r).toEqual({ markdown: "false", dataType: "boolean" });
});

// ── Fallback (unknown object type) ──────────────────────────────────

test("non-matching object is stringified", async () => {
  const d = new Date("2024-01-15T00:00:00.000Z");
  const r = renderResultToMarkdown(d);
  expect(r.dataType).toBe("string");
  expect(r.markdown).toContain("2024");
});

// ── LuaTable: empty ─────────────────────────────────────────────────

test("empty LuaTable", async () => {
  const r = renderResultToMarkdown(new LuaTable());
  expect(r).toEqual({
    markdown: "<table data-table-empty></table>",
    dataType: "table",
  });
});

// ── LuaTable: pure array of scalars ─────────────────────────────────

test("LuaTable array of scalars renders as unmarked list, one item per line", async () => {
  const tbl = new LuaTable();
  await tbl.rawSet(1, "alpha");
  await tbl.rawSet(2, "beta");
  await tbl.rawSet(3, "gamma");

  const r = renderResultToMarkdown(tbl);
  expect(r.dataType).toBe("list");
  expect(r.markdown).toBe("alpha\nbeta\ngamma");
});

// ── LuaTable: array of LuaTables → multi-row table ─────────────────

test("LuaTable array of LuaTables renders as multi-row table", async () => {
  const row1 = new LuaTable();
  await row1.rawSet("name", "Alice");
  await row1.rawSet("age", 30);

  const row2 = new LuaTable();
  await row2.rawSet("name", "Bob");
  await row2.rawSet("age", 25);

  const tbl = new LuaTable();
  await tbl.rawSet(1, row1);
  await tbl.rawSet(2, row2);

  const r = renderResultToMarkdown(tbl);
  expect(r.dataType).toBe("list");
  expect(r.markdown).toBe(
    "<table><thead><tr><th>name</th><th>age</th></tr></thead>" +
      "<tbody>" +
      '<tr><td data-table-cell-type="string">Alice</td><td data-table-cell-type="number">30</td></tr>' +
      '<tr><td data-table-cell-type="string">Bob</td><td data-table-cell-type="number">25</td></tr>' +
      "</tbody></table>",
  );
});

// ── LuaTable: record (string keys) ─────────────────────────────────

test("LuaTable with string keys renders as single-row table", async () => {
  const tbl = new LuaTable();
  await tbl.rawSet("x", 10);
  await tbl.rawSet("y", 20);

  const r = renderResultToMarkdown(tbl);
  expect(r.dataType).toBe("table");
  expect(r.markdown).toBe(
    "<table><thead><tr><th>x</th><th>y</th></tr></thead>" +
      '<tbody><tr><td data-table-cell-type="number">10</td><td data-table-cell-type="number">20</td></tr></tbody></table>',
  );
});

// ── LuaTable: mixed keys ────────────────────────────────────────────

test("LuaTable with mixed keys uses keys order in header", async () => {
  const tbl = new LuaTable();
  await tbl.rawSet(1, "first");
  await tbl.rawSet("label", "test");

  const r = renderResultToMarkdown(tbl);
  expect(r.dataType).toBe("table");
  expect(r.markdown).toContain("<th>1</th>");
  expect(r.markdown).toContain("<th>label</th>");
  expect(r.markdown).toContain("first");
  expect(r.markdown).toContain("test");
});

// ── Null / empty values inside cells ────────────────────────────────

test("LIQ_NULL value in a table cell renders as empty td", async () => {
  const row = new LuaTable();
  await row.rawSet("a", 1);
  await row.rawSet("b", LIQ_NULL);

  const tbl = new LuaTable();
  await tbl.rawSet(1, row);

  const r = renderResultToMarkdown(tbl);
  expect(r.markdown).toContain("<th>b</th>");
  expect(r.markdown).toContain("<td data-table-cell-empty></td>");
});

test("LIQ_NULL in a table cell renders as empty td", async () => {
  const row = new LuaTable();
  await row.rawSet("val", LIQ_NULL);

  const tbl = new LuaTable();
  await tbl.rawSet(1, row);

  const r = renderResultToMarkdown(tbl);
  expect(r.markdown).toContain("<td data-table-cell-empty></td>");
});

test("LIQ_NULL item in a list renders as empty bullet", async () => {
  const tbl = new LuaTable();
  await tbl.rawSet(1, 1);
  await tbl.rawSet(2, LIQ_NULL);
  await tbl.rawSet(3, 3);

  const r = renderResultToMarkdown(tbl);
  expect(r.dataType).toBe("list");
  expect(r.markdown).toBe("1\n\n3");
});

// ── Sparse / missing key handling ───────────────────────────────────

test("LuaTable array with different keys shows union of headers", async () => {
  const row1 = new LuaTable();
  await row1.rawSet("x", 1);

  const row2 = new LuaTable();
  await row2.rawSet("y", 2);

  const tbl = new LuaTable();
  await tbl.rawSet(1, row1);
  await tbl.rawSet(2, row2);

  const r = renderResultToMarkdown(tbl);
  expect(r.markdown).toContain("<th>x</th>");
  expect(r.markdown).toContain("<th>y</th>");
  const empties = r.markdown.match(/<td data-table-cell-empty><\/td>/g);
  expect(empties).toHaveLength(2);
});

// ── Nested rendering ────────────────────────────────────────────────

test("nested LuaTable in a cell renders recursively", async () => {
  const inner = new LuaTable();
  await inner.rawSet("nested", "value");

  const tbl = new LuaTable();
  await tbl.rawSet("data", inner);

  const r = renderResultToMarkdown(tbl);
  expect(r.dataType).toBe("table");
  expect(r.markdown).toContain("<th>nested</th>");
  expect(r.markdown).toContain("value");
});

test("nested empty LuaTable in a cell renders as empty table", async () => {
  const tbl = new LuaTable();
  await tbl.rawSet("child", new LuaTable());

  const r = renderResultToMarkdown(tbl);
  expect(r.markdown).toContain("<table data-table-empty></table>");
});

test("nested table inside a table cell", async () => {
  const inner = new LuaTable();
  await inner.rawSet("a", 1);
  await inner.rawSet("b", 2);

  const outer = new LuaTable();
  await outer.rawSet("info", inner);
  await outer.rawSet("label", "test");

  const r = renderResultToMarkdown(outer);
  expect(r.dataType).toBe("table");
  expect(r.markdown).toContain("<th>info</th>");
  expect(r.markdown).toContain("<th>label</th>");
  expect(r.markdown).toMatch(
    /<td[^>]*><table>.*<th>a<\/th>.*<th>b<\/th>.*<\/table><\/td>/,
  );
});

test("nested table array inside a table cell", async () => {
  const row1 = new LuaTable();
  await row1.rawSet("x", 10);
  const row2 = new LuaTable();
  await row2.rawSet("x", 20);

  const innerArray = new LuaTable();
  await innerArray.rawSet(1, row1);
  await innerArray.rawSet(2, row2);

  const outer = new LuaTable();
  await outer.rawSet("data", innerArray);

  const r = renderResultToMarkdown(outer);
  expect(r.dataType).toBe("table");
  expect(r.markdown).toContain("<th>data</th>");
  const tableCount = r.markdown.match(/<table>/g);
  expect(tableCount).toHaveLength(2);
});

test("deeply nested tables (3 levels)", async () => {
  const deepest = new LuaTable();
  await deepest.rawSet("val", 42);

  const middle = new LuaTable();
  await middle.rawSet("inner", deepest);

  const outer = new LuaTable();
  await outer.rawSet("middle", middle);

  const r = renderResultToMarkdown(outer);
  expect(r.dataType).toBe("table");
  const tableCount = r.markdown.match(/<table>/g);
  expect(tableCount).toHaveLength(3);
  expect(r.markdown).toContain('<td data-table-cell-type="number">42</td>');
});

test("nested scalar array in table cell renders as br-separated lines", async () => {
  const inner = new LuaTable();
  await inner.rawSet(1, "aaa");
  await inner.rawSet(2, "bbb");

  const row = new LuaTable();
  await row.rawSet("name", "Sup");
  await row.rawSet("hello", inner);

  const tbl = new LuaTable();
  await tbl.rawSet(1, row);

  const r = renderResultToMarkdown(tbl);
  expect(r.markdown).toContain("aaa<br>bbb");
});

// ── Markdown in cell values ─────────────────────────────────────────

test("wiki link syntax in table cell is preserved", async () => {
  const row = new LuaTable();
  await row.rawSet("name", "[[Alice]]");

  const tbl = new LuaTable();
  await tbl.rawSet(1, row);

  const r = renderResultToMarkdown(tbl);
  expect(r.markdown).toContain("[[Alice]]");
  expect(r.markdown).toMatch(/<td[^>]*>\[\[Alice\]\]<\/td>/);
});

test("bold syntax in table cell is preserved", async () => {
  const row = new LuaTable();
  await row.rawSet("text", "**important**");

  const tbl = new LuaTable();
  await tbl.rawSet(1, row);

  const r = renderResultToMarkdown(tbl);
  expect(r.markdown).toContain("**important**");
});

test("hashtag in list item is preserved", async () => {
  const tbl = new LuaTable();
  await tbl.rawSet(1, "#tag1");
  await tbl.rawSet(2, "#tag2");

  const r = renderResultToMarkdown(tbl);
  expect(r.markdown).toContain("#tag1");
  expect(r.markdown).toContain("#tag2");
});

test("wiki link in list item is preserved", async () => {
  const tbl = new LuaTable();
  await tbl.rawSet(1, "[[Page1]]");
  await tbl.rawSet(2, "[[Page2]]");

  const r = renderResultToMarkdown(tbl);
  expect(r.dataType).toBe("list");
  expect(r.markdown).toBe("[[Page1]]\n[[Page2]]");
});

test("bold in list item is preserved", async () => {
  const tbl = new LuaTable();
  await tbl.rawSet(1, "**bold**");
  await tbl.rawSet(2, "normal");

  const r = renderResultToMarkdown(tbl);
  expect(r.markdown).toBe("**bold**\nnormal");
});

// ── End-to-end: markdown → parse → HTML ─────────────────────────────

test("e2e: table with wiki links produces clickable links", async () => {
  const row = new LuaTable();
  await row.rawSet("name", "[[Alice]]");
  await row.rawSet("age", 30);

  const tbl = new LuaTable();
  await tbl.rawSet(1, row);

  expect(toHtml(tbl)).toBe(
    '<table><thead><tr><th>name</th><th>age</th></tr></thead><tbody>' +
      '<tr><td data-table-cell-type="string">' +
      '<a href="/Alice" class="wiki-link" data-ref="Alice">Alice</a></td>' +
      '<td data-table-cell-type="number">30</td></tr></tbody></table>',
  );
});

test("e2e: table with bold text renders strong tags", async () => {
  const row = new LuaTable();
  await row.rawSet("note", "**important**");

  const tbl = new LuaTable();
  await tbl.rawSet(1, row);

  expect(toHtml(tbl)).toBe(
    "<table><thead><tr><th>note</th></tr></thead><tbody>" +
      '<tr><td data-table-cell-type="string">' +
      "<strong>important</strong></td></tr></tbody></table>",
  );
});

test("e2e: scalar list renders each item on its own line", async () => {
  const tbl = new LuaTable();
  await tbl.rawSet(1, "first");
  await tbl.rawSet(2, "second");
  await tbl.rawSet(3, "third");

  expect(toHtml(tbl)).toBe(
    '<span class="p">first<br>second<br>third</span>',
  );
});

test("e2e: list with wiki links", async () => {
  const tbl = new LuaTable();
  await tbl.rawSet(1, "[[PageA]]");
  await tbl.rawSet(2, "[[PageB]]");

  expect(toHtml(tbl)).toBe(
    '<span class="p">' +
      '<a href="/PageA" class="wiki-link" data-ref="PageA">PageA</a><br>' +
      '<a href="/PageB" class="wiki-link" data-ref="PageB">PageB</a></span>',
  );
});

test("e2e: string with markdown formatting", () => {
  expect(toHtml("hello **world** and [[MyPage]]")).toBe(
    '<span class="p">hello <strong>world</strong> and ' +
      '<a href="/MyPage" class="wiki-link" data-ref="MyPage">MyPage</a></span>',
  );
});

test("e2e: multi-row table preserves structure", async () => {
  const row1 = new LuaTable();
  await row1.rawSet("id", 1);
  await row1.rawSet("name", "Alice");

  const row2 = new LuaTable();
  await row2.rawSet("id", 2);
  await row2.rawSet("name", "Bob");

  const tbl = new LuaTable();
  await tbl.rawSet(1, row1);
  await tbl.rawSet(2, row2);

  expect(toHtml(tbl)).toBe(
    "<table><thead><tr><th>id</th><th>name</th></tr></thead><tbody>" +
      '<tr><td data-table-cell-type="number">1</td>' +
      '<td data-table-cell-type="string">Alice</td></tr>' +
      '<tr><td data-table-cell-type="number">2</td>' +
      '<td data-table-cell-type="string">Bob</td></tr></tbody></table>',
  );
});

test("e2e: nested array in table cell renders as br-separated lines", async () => {
  const inner = new LuaTable();
  await inner.rawSet(1, "aaa");
  await inner.rawSet(2, "bbb");

  const row = new LuaTable();
  await row.rawSet("name", "Sup");
  await row.rawSet("hello", inner);

  const tbl = new LuaTable();
  await tbl.rawSet(1, row);

  expect(toHtml(tbl)).toBe(
    "<table><thead><tr><th>name</th><th>hello</th></tr></thead><tbody>" +
      '<tr><td data-table-cell-type="string">Sup</td>' +
      '<td data-table-cell-type="array">aaa<br>bbb</br></td></tr></tbody></table>',
  );
});

test("e2e: empty table preserves data-table-empty attribute", async () => {
  expect(toHtml(new LuaTable())).toBe('<table data-table-empty=""></table>');
});

test("e2e: data attributes survive the pipeline", async () => {
  const row = new LuaTable();
  await row.rawSet("x", 42);
  await row.rawSet("y", LIQ_NULL);

  const tbl = new LuaTable();
  await tbl.rawSet(1, row);

  expect(toHtml(tbl)).toBe(
    "<table><thead><tr><th>x</th><th>y</th></tr></thead><tbody>" +
      '<tr><td data-table-cell-type="number">42</td>' +
      '<td data-table-cell-empty=""></td></tr></tbody></table>',
  );
});

test("e2e: nested table in cell renders full sub-table", async () => {
  const inner = new LuaTable();
  await inner.rawSet("a", 1);
  await inner.rawSet("b", 2);

  const outer = new LuaTable();
  await outer.rawSet("info", inner);
  await outer.rawSet("label", "test");

  expect(toHtml(outer)).toBe(
    "<table><thead><tr><th>info</th><th>label</th></tr></thead><tbody>" +
      '<tr><td data-table-cell-type="table">' +
      "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody>" +
      '<tr><td data-table-cell-type="number">1</td>' +
      '<td data-table-cell-type="number">2</td></tr></tbody></table></td>' +
      '<td data-table-cell-type="string">test</td></tr></tbody></table>',
  );
});
