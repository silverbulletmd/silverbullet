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

test("refuses tables, missing cells, page-lua names, formulas and duplicates", () => {
  expect(() =>
    planPageVarEdit("${x = 1}", "Budget", "x", new LuaTable()),
  ).toThrow(
    "pageVars.set: only numbers, strings, booleans and nil can be stored",
  );
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
