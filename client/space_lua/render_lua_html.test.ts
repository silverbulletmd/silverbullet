import { expect, test } from "vitest";
import { renderResultToHtml } from "./render_lua_html.ts";
import { LuaTable } from "./runtime.ts";
import { makeLuaFloat } from "./numeric.ts";
import { LIQ_NULL } from "./liq_null.ts";

// ── Nil / empty values ──────────────────────────────────────────────

test("null renders as empty span with dataType nil", async () => {
  const r = await renderResultToHtml(null);
  expect(r).toEqual({ html: `<span data-empty></span>`, dataType: "nil" });
});

test("undefined renders as empty span with dataType nil", async () => {
  const r = await renderResultToHtml(undefined);
  expect(r).toEqual({ html: `<span data-empty></span>`, dataType: "nil" });
});

test("LIQ_NULL (SQL NULL) renders as empty span with dataType nil", async () => {
  const r = await renderResultToHtml(LIQ_NULL);
  expect(r).toEqual({ html: `<span data-empty></span>`, dataType: "nil" });
});

// ── Strings ─────────────────────────────────────────────────────────

test("string renders with default escaping", async () => {
  const r = await renderResultToHtml("hello world");
  expect(r).toEqual({ html: "hello world", dataType: "string" });
});

test("empty string is rendered (not treated as nil)", async () => {
  const r = await renderResultToHtml("");
  expect(r).toEqual({ html: "", dataType: "string" });
});

test("string with HTML special chars is escaped", async () => {
  const r = await renderResultToHtml('<b>"Tom & Jerry"</b>');
  expect(r).toEqual({
    html: '&lt;b&gt;&quot;Tom &amp; Jerry&quot;&lt;/b&gt;',
    dataType: "string",
  });
});

// ── Numbers ─────────────────────────────────────────────────────────

test("integer number", async () => {
  const r = await renderResultToHtml(42);
  expect(r).toEqual({ html: "42", dataType: "number" });
});

test("zero", async () => {
  const r = await renderResultToHtml(0);
  expect(r).toEqual({ html: "0", dataType: "number" });
});

test("non-integer float", async () => {
  const r = await renderResultToHtml(1.5);
  expect(r).toEqual({ html: "1.5", dataType: "number" });
});

test("tagged float (integer-valued)", async () => {
  const r = await renderResultToHtml(makeLuaFloat(2));
  expect(r).toEqual({ html: "2.0", dataType: "number" });
});

// ── Booleans ────────────────────────────────────────────────────────

test("boolean true", async () => {
  const r = await renderResultToHtml(true);
  expect(r).toEqual({ html: "true", dataType: "boolean" });
});

test("boolean false", async () => {
  const r = await renderResultToHtml(false);
  expect(r).toEqual({ html: "false", dataType: "boolean" });
});

// ── Fallback (unknown object type) ──────────────────────────────────

test("non-matching object is stringified via renderInline", async () => {
  const d = new Date("2024-01-15T00:00:00.000Z");
  const r = await renderResultToHtml(d);
  expect(r.dataType).toBe("string");
  expect(r.html).toContain("2024"); // toString includes year
});

// ── Custom renderInline ─────────────────────────────────────────────

test("custom renderInline is used for strings", async () => {
  const custom = (s: string) => `<em>${s}</em>`;
  const r = await renderResultToHtml("hello", custom);
  expect(r).toEqual({ html: "<em>hello</em>", dataType: "string" });
});

// ── LuaTable: empty ─────────────────────────────────────────────────

test("empty LuaTable", async () => {
  const r = await renderResultToHtml(new LuaTable());
  expect(r).toEqual({
    html: `<table data-table-empty></table>`,
    dataType: "table",
  });
});

// ── LuaTable: pure array of scalars ─────────────────────────────────

test("LuaTable array of scalars renders as <ul>", async () => {
  const tbl = new LuaTable();
  void tbl.rawSet(1, "alpha");
  void tbl.rawSet(2, "beta");
  void tbl.rawSet(3, "gamma");

  const r = await renderResultToHtml(tbl);
  expect(r.dataType).toBe("list");
  expect(r.html).toBe(
    '<ul><li data-list-item-type="string">alpha</li>' +
      '<li data-list-item-type="string">beta</li>' +
      '<li data-list-item-type="string">gamma</li></ul>',
  );
});

// ── LuaTable: array of LuaTables → multi-row table ─────────────────

test("LuaTable array of LuaTables renders as multi-row table", async () => {
  const row1 = new LuaTable();
  void row1.rawSet("name", "Alice");
  void row1.rawSet("age", 30);

  const row2 = new LuaTable();
  void row2.rawSet("name", "Bob");
  void row2.rawSet("age", 25);

  const tbl = new LuaTable();
  void tbl.rawSet(1, row1);
  void tbl.rawSet(2, row2);

  const r = await renderResultToHtml(tbl);
  expect(r.dataType).toBe("list");
  expect(r.html).toBe(
    "<table>" +
      "<thead><tr><th>name</th><th>age</th></tr></thead>" +
      "<tbody>" +
      '<tr><td data-table-cell-type="string">Alice</td><td data-table-cell-type="number">30</td></tr>' +
      '<tr><td data-table-cell-type="string">Bob</td><td data-table-cell-type="number">25</td></tr>' +
      "</tbody>" +
      "</table>",
  );
});

// ── LuaTable: record (string keys) ─────────────────────────────────

test("LuaTable with string keys renders as single-row table", async () => {
  const tbl = new LuaTable();
  void tbl.rawSet("x", 10);
  void tbl.rawSet("y", 20);

  const r = await renderResultToHtml(tbl);
  expect(r.dataType).toBe("table");
  expect(r.html).toBe(
    "<table>" +
      "<thead><tr><th>x</th><th>y</th></tr></thead>" +
      "<tbody><tr>" +
      '<td data-table-cell-type="number">10</td>' +
      '<td data-table-cell-type="number">20</td>' +
      "</tr></tbody>" +
      "</table>",
  );
});

// ── LuaTable: mixed keys ────────────────────────────────────────────

test("LuaTable with mixed keys uses keys order in header", async () => {
  const tbl = new LuaTable();
  void tbl.rawSet(1, "first");
  void tbl.rawSet("label", "test");

  const r = await renderResultToHtml(tbl);
  expect(r.dataType).toBe("table");
  // hasStringKeys → record path; keys() returns both 1 and "label"
  expect(r.html).toContain("<th>1</th>");
  expect(r.html).toContain("<th>label</th>");
  expect(r.html).toContain("first");
  expect(r.html).toContain("test");
});

// ── JS arrays ───────────────────────────────────────────────────────

test("empty JS array", async () => {
  const r = await renderResultToHtml([]);
  expect(r).toEqual({
    html: `<table data-table-empty></table>`,
    dataType: "table",
  });
});

test("JS array of plain objects renders as multi-row table", async () => {
  const r = await renderResultToHtml([
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ]);
  expect(r.dataType).toBe("table");
  expect(r.html).toBe(
    "<table>" +
      "<thead><tr><th>id</th><th>name</th></tr></thead>" +
      "<tbody>" +
      '<tr><td data-table-cell-type="number">1</td><td data-table-cell-type="string">Alice</td></tr>' +
      '<tr><td data-table-cell-type="number">2</td><td data-table-cell-type="string">Bob</td></tr>' +
      "</tbody>" +
      "</table>",
  );
});

test("JS array of scalars renders as <ul>", async () => {
  const r = await renderResultToHtml([10, 20, 30]);
  expect(r.dataType).toBe("list");
  expect(r.html).toBe(
    '<ul><li data-list-item-type="number">10</li>' +
      '<li data-list-item-type="number">20</li>' +
      '<li data-list-item-type="number">30</li></ul>',
  );
});

// ── JS objects ──────────────────────────────────────────────────────

test("empty JS object", async () => {
  const r = await renderResultToHtml({});
  expect(r).toEqual({
    html: `<table data-table-empty></table>`,
    dataType: "table",
  });
});

test("single JS plain object renders as single-row table", async () => {
  const r = await renderResultToHtml({ color: "red", count: 5 });
  expect(r.dataType).toBe("table");
  expect(r.html).toBe(
    "<table>" +
      "<thead><tr><th>color</th><th>count</th></tr></thead>" +
      "<tbody><tr>" +
      '<td data-table-cell-type="string">red</td>' +
      '<td data-table-cell-type="number">5</td>' +
      "</tr></tbody>" +
      "</table>",
  );
});

// ── Null / empty values inside cells ────────────────────────────────

test("null value in a table cell gets data-table-cell-empty", async () => {
  const r = await renderResultToHtml([{ a: 1, b: null }]);
  expect(r.html).toContain('data-table-cell-empty');
  expect(r.html).toContain("<th>b</th>");
});

test("LIQ_NULL in a table cell gets data-table-cell-empty", async () => {
  const r = await renderResultToHtml([{ a: 1, b: LIQ_NULL }]);
  expect(r.html).toContain('data-table-cell-empty');
});

test("null item in a list gets data-list-item-empty", async () => {
  const r = await renderResultToHtml([1, null, 3]);
  expect(r.dataType).toBe("list");
  expect(r.html).toContain("data-list-item-empty");
});

test("LIQ_NULL in LuaTable cell gets data-table-cell-empty", async () => {
  const row = new LuaTable();
  void row.rawSet("val", LIQ_NULL);

  const tbl = new LuaTable();
  void tbl.rawSet(1, row);

  const r = await renderResultToHtml(tbl);
  expect(r.html).toContain("data-table-cell-empty");
});

// ── Sparse / missing key handling ───────────────────────────────────

test("JS object array with different keys shows union of headers", async () => {
  const r = await renderResultToHtml([
    { a: 1, b: 2 },
    { b: 3, c: 4 },
  ]);
  expect(r.dataType).toBe("table");
  expect(r.html).toContain("<th>a</th>");
  expect(r.html).toContain("<th>b</th>");
  expect(r.html).toContain("<th>c</th>");
  // Row 1 has no "c", row 2 has no "a" → both get empty cells
  // Count occurrences of data-table-cell-empty
  const empties = r.html.match(/data-table-cell-empty/g);
  expect(empties).toHaveLength(2);
});

test("LuaTable array with different keys shows union of headers", async () => {
  const row1 = new LuaTable();
  void row1.rawSet("x", 1);

  const row2 = new LuaTable();
  void row2.rawSet("y", 2);

  const tbl = new LuaTable();
  void tbl.rawSet(1, row1);
  void tbl.rawSet(2, row2);

  const r = await renderResultToHtml(tbl);
  expect(r.html).toContain("<th>x</th>");
  expect(r.html).toContain("<th>y</th>");
  const empties = r.html.match(/data-table-cell-empty/g);
  expect(empties).toHaveLength(2);
});

// ── Nested rendering ────────────────────────────────────────────────

test("nested LuaTable in a cell renders recursively", async () => {
  const inner = new LuaTable();
  void inner.rawSet("nested", "value");

  const tbl = new LuaTable();
  void tbl.rawSet("data", inner);

  const r = await renderResultToHtml(tbl);
  expect(r.dataType).toBe("table");
  // The outer td should contain a nested <table>
  expect(r.html).toContain('<td data-table-cell-type="table">');
  expect(r.html).toContain("<th>nested</th>");
  expect(r.html).toContain("value");
});

test("nested JS array in a plain object cell", async () => {
  const r = await renderResultToHtml({ items: [1, 2, 3] });
  expect(r.dataType).toBe("table");
  expect(r.html).toContain('<td data-table-cell-type="array">');
  expect(r.html).toContain("<ul>");
  expect(r.html).toContain("<li");
});

test("nested empty LuaTable in a cell renders as empty table", async () => {
  const tbl = new LuaTable();
  void tbl.rawSet("child", new LuaTable());

  const r = await renderResultToHtml(tbl);
  expect(r.html).toContain("data-table-empty");
});
