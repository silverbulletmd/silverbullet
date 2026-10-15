import { expect, test } from "vitest";
import { planPageVarEdit, toLuaLiteral } from "./page_var_edit.ts";
import { LuaTable } from "./runtime.ts";
import { makeLuaFloat } from "./numeric.ts";

const apply = (text: string, name: string, value: unknown) => {
  const edit = planPageVarEdit(text, "Budget", name, value);
  if (!edit) return text;
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
};

test("rewrites only the cell's expression, keeping its spacing", () => {
  const text =
    "Pay ${salary = 500} and ${ rate =  0.1 } plus ${salary * rate}\n";
  expect(apply(text, "rate", makeLuaFloat(0.2))).toBe(
    "Pay ${salary = 500} and ${ rate =  0.2 } plus ${salary * rate}\n",
  );
  expect(apply(text, "salary", 600)).toBe(
    "Pay ${salary = 600} and ${ rate =  0.1 } plus ${salary * rate}\n",
  );
});

test("setting the value a cell already has changes nothing", () => {
  expect(planPageVarEdit("${n = 3}", "Budget", "n", 3)).toBeNull();
  expect(planPageVarEdit('${s = "a"}', "Budget", "s", "a")).toBeNull();
});

test("literal values: negative numbers, strings, booleans and nil", () => {
  expect(apply("${x = -1}", "x", -2)).toBe("${x = -2}");
  expect(apply('${x = "a"}', "x", 'say "hi"\\\n')).toBe(
    '${x = "say \\"hi\\"\\\\\\n"}',
  );
  expect(apply("${x = false}", "x", true)).toBe("${x = true}");
  expect(apply("${x = nil}", "x", null)).toBe("${x = nil}");
  expect(apply("${x = 1}", "x", undefined)).toBe("${x = nil}");
});

test("tables are pretty printed: list items first, then fields", () => {
  const todos = new LuaTable([
    new LuaTable({ title: "Book venue", done: true }),
    new LuaTable({ title: "Send invites", done: false }),
  ]);
  expect(apply("${todos = {}}", "todos", todos)).toBe(
    [
      "${todos = {",
      "  {",
      '    title = "Book venue",',
      "    done = true,",
      "  },",
      "  {",
      '    title = "Send invites",',
      "    done = false,",
      "  },",
      "}}",
    ].join("\n"),
  );
  // The rewritten multi-line cell reads back as the same value
  const written = apply("${todos = {}}", "todos", todos);
  expect(planPageVarEdit(written, "Budget", "todos", todos)).toBeNull();
  expect(toLuaLiteral(new LuaTable())).toBe("{}");
  expect(toLuaLiteral(new LuaTable([1]))).toBe("{1}");
  const mixed = new LuaTable([1, 2]);
  void mixed.rawSet("due date", "2026-11-01");
  void mixed.rawSet(true, "yes");
  expect(toLuaLiteral(mixed)).toBe(
    '{\n  1,\n  2,\n  ["due date"] = "2026-11-01",\n  [true] = "yes",\n}',
  );
});

test("tables keep floats stored in them", () => {
  const t = new LuaTable();
  void t.rawSet("rate", makeLuaFloat(2));
  expect(toLuaLiteral(t)).toBe("{rate = 2.0}");
});

test("a table cell's continuation lines follow the cell's indentation", () => {
  const text = "* Items:\n  ${items = {}}\n";
  expect(apply(text, "items", new LuaTable(["a", "b"]))).toBe(
    '* Items:\n  ${items = {\n    "a",\n    "b",\n  }}\n',
  );
});

test("table literals can be set; tables holding formulas can't", () => {
  expect(apply("${t = {1, -2, {x = 'a'}}}", "t", new LuaTable([3]))).toBe(
    "${t = {3}}",
  );
  expect(() =>
    planPageVarEdit("${t = {a + 1}}", "Budget", "t", new LuaTable()),
  ).toThrow("pageVars.set: t is a formula, not a value");
  expect(() =>
    planPageVarEdit("${t = {[k] = 1}}", "Budget", "t", new LuaTable()),
  ).toThrow("pageVars.set: t is a formula, not a value");
});

test("setting a table to the value its cell holds changes nothing", () => {
  const text = "${t = { 'a',  b = 1 }}";
  const same = new LuaTable(["a"]);
  void same.rawSet("b", 1);
  expect(planPageVarEdit(text, "Budget", "t", same)).toBeNull();
});

test("refuses functions, tables with metatables and cyclic tables", () => {
  const notStorable =
    "pageVars.set: only numbers, strings, booleans, nil and tables of these can be stored";
  expect(() => toLuaLiteral(() => 1)).toThrow(notStorable);
  const withMeta = new LuaTable();
  withMeta.metatable = new LuaTable();
  expect(() => toLuaLiteral(withMeta)).toThrow(notStorable);
  const cyclic = new LuaTable();
  void cyclic.rawSet("self", cyclic);
  expect(() => toLuaLiteral(cyclic)).toThrow(
    "pageVars.set: a table can't contain itself",
  );
});

test("refuses missing cells, page-lua names, formulas and duplicates", () => {
  expect(() => planPageVarEdit("${x = 1}", "Budget", "rate", 1)).toThrow(
    "pageVars.set: Budget has no ${rate = …}",
  );
  const block = "```page-lua\nrate = 1\n```\n";
  expect(() => planPageVarEdit(block, "Budget", "rate", 2)).toThrow(
    "pageVars.set: Budget has no ${rate = …}",
  );
  expect(() => planPageVarEdit("${t = a + b}", "Budget", "t", 2)).toThrow(
    "pageVars.set: t is a formula, not a value",
  );
  expect(() => planPageVarEdit("${x = 1} ${x = 2}", "Budget", "x", 3)).toThrow(
    "pageVars.set: x is defined more than once on Budget",
  );
});

test("numbers keep their integer or float form", () => {
  expect(toLuaLiteral(3)).toBe("3");
  expect(toLuaLiteral(makeLuaFloat(3))).toBe("3.0");
  expect(toLuaLiteral(0.25)).toBe("0.25");
});
