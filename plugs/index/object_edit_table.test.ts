import { beforeEach, expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { applyEdits } from "./object_edit.ts";
import {
  planTableAppend,
  planTableDelete,
  planTableUpdate,
  splitCells,
} from "./object_edit_table.ts";
import { objectsOf, planCtx } from "./object_test_util.ts";

beforeEach(() => {
  createMockSystem();
});

const page =
  "| What | Amount | Due date |\n|---|---|---|\n| Tram | 12.5 | |\n| Bus |\n";

async function rows(text: string) {
  return (await objectsOf(text)).filter((o) => o.tag === "table");
}

test("splitCells handles outer pipes, empty cells and escaped pipes", () => {
  expect(splitCells("| a | | c\\|d |")).toEqual(["a", "", "c\\|d"]);
  expect(splitCells("a | b")).toEqual(["a", "b"]);
});

test("update writes into the right column, including empty and missing cells", async () => {
  const [tram, bus] = await rows(page);
  expect(
    applyEdits(
      page,
      planTableUpdate(planCtx(page), tram, { due_date: "2026-11-01" }, []),
    ),
  ).toBe(
    "| What | Amount | Due date |\n|---|---|---|\n| Tram | 12.5 | 2026-11-01 |\n| Bus |\n",
  );
  expect(
    applyEdits(page, planTableUpdate(planCtx(page), bus, { amount: 3 }, [])),
  ).toBe(
    "| What | Amount | Due date |\n|---|---|---|\n| Tram | 12.5 | |\n| Bus | 3 |  |\n",
  );
  expect(
    applyEdits(page, planTableUpdate(planCtx(page), tram, {}, ["amount"])),
  ).toBe(
    "| What | Amount | Due date |\n|---|---|---|\n| Tram |  |  |\n| Bus |\n",
  );
  expect(() =>
    planTableUpdate(planCtx(page), tram, { colour: "red" }, []),
  ).toThrow('the table has no column "colour"');
});

test("cell values escape pipes and newlines", async () => {
  const [tram] = await rows(page);
  expect(
    applyEdits(
      page,
      planTableUpdate(planCtx(page), tram, { what: "a|b\nc" }, []),
    ),
  ).toContain("| a\\|b c | 12.5 |  |");
});

test("delete removes the row line", async () => {
  const [tram] = await rows(page);
  expect(applyEdits(page, planTableDelete(planCtx(page), tram))).toBe(
    "| What | Amount | Due date |\n|---|---|---|\n| Bus |\n",
  );
});

test("append adds a row in header order to the only table, or a given one", () => {
  const ctx = planCtx(page);
  expect(
    applyEdits(
      page,
      planTableAppend(
        ctx,
        { tag: "table", amount: 2, what: "Taxi" },
        undefined,
        undefined,
      ),
    ),
  ).toBe(
    "| What | Amount | Due date |\n|---|---|---|\n| Tram | 12.5 | |\n| Bus |\n| Taxi | 2 |  |\n",
  );
  expect(() =>
    planTableAppend(ctx, { tag: "table", colour: "red" }, undefined, undefined),
  ).toThrow('the table has no column "colour"');
  const two = `${page}\n| A |\n|---|\n| x |\n`;
  const twoCtx = planCtx(two);
  expect(() =>
    planTableAppend(twoCtx, { tag: "table", a: "y" }, undefined, undefined),
  ).toThrow("the page has several tables; pass options.table");
  expect(
    applyEdits(
      two,
      planTableAppend(
        twoCtx,
        { tag: "table", a: "y" },
        undefined,
        `Notes@${two.indexOf("| A |")}`,
      ),
    ),
  ).toBe(`${page}\n| A |\n|---|\n| x |\n| y |\n`);
});
