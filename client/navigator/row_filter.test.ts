import { expect, test } from "vitest";
import { indexViewRows, rankViewRows } from "./row_filter.ts";

test("view filtering matches primary and description by default", () => {
  const rows = [
    { primary: "Maple", description: "Copper trail", obj: { code: "K7" } },
    {
      primary: "Cedar",
      description: "Silver trail",
      obj: { code: "M2" },
      cells: ["secret display"],
    },
  ];
  const indexed = indexViewRows(rows);
  expect(rankViewRows(indexed, "Maple").map((entry) => entry.row)).toEqual([
    rows[0],
  ]);
  expect(rankViewRows(indexed, "Silver").map((entry) => entry.row)).toEqual([
    rows[1],
  ]);
  expect(rankViewRows(indexed, "secret")).toEqual([]);
  expect(rankViewRows(indexed, "").map((entry) => entry.row)).toEqual(rows);
});

test("custom fields match source attributes", () => {
  const rows = [
    { primary: "Maple", obj: { code: "K7" } },
    { primary: "Cedar", obj: { code: "M2" } },
  ];
  const indexed = indexViewRows(rows);
  expect(
    rankViewRows(indexed, "M2", { code: 1 }).map((entry) => entry.row),
  ).toEqual([rows[1]]);
  expect(rankViewRows(indexed, "Maple", { code: 1 })).toEqual([]);
});
