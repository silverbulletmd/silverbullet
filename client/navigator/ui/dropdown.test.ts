import { expect, test } from "vitest";
import type { DropdownOption, Row, SegmentMeta } from "../types.ts";
import {
  applyDropdown,
  type DropdownMasks,
  dropdownIndexFor,
} from "./dropdown.ts";
import { applySegment, type SegmentMasks } from "./segments.ts";

const options: DropdownOption[] = [
  { label: "Pete", value: "People/Pete Smith" },
  { label: "Anna", value: "People/Anna Jones" },
];

function row(name: string): Row {
  return { obj: { name }, primary: name };
}

/** `masks[i]` lines up with `rows[i]`, each entry parallel to `options`. */
function masksFor(rows: Row[], masks: boolean[][]): DropdownMasks {
  const out: DropdownMasks = new WeakMap();
  rows.forEach((r, i) => out.set(r, masks[i]));
  return out;
}

test("a selected value resolves to its option, anything else to All", () => {
  expect(dropdownIndexFor(options, "People/Anna Jones")).toBe(1);
  expect(dropdownIndexFor(options, "People/Gone")).toBe(-1);
  expect(dropdownIndexFor(options, undefined)).toBe(-1);
  expect(dropdownIndexFor(options, null)).toBe(-1);
  expect(dropdownIndexFor(undefined, "People/Pete Smith")).toBe(-1);
  expect(dropdownIndexFor([], "People/Pete Smith")).toBe(-1);
});

test("All (index -1) passes every row through, without needing masks", () => {
  const rows = [row("a"), row("b")];
  expect(applyDropdown(rows, -1)).toEqual(rows);
});

test("a selected option keeps only the rows its mask admits", () => {
  const rows = [row("a"), row("b"), row("c")];
  const masks = masksFor(rows, [
    [true, false],
    [false, true],
    [true, true],
  ]);
  expect(applyDropdown(rows, 0, masks).map((r) => r.primary)).toEqual([
    "a",
    "c",
  ]);
  expect(applyDropdown(rows, 1, masks).map((r) => r.primary)).toEqual([
    "b",
    "c",
  ]);
});

test("a row with no mask is dropped, not admitted", () => {
  const rows = [row("a"), row("b")];
  const masks = masksFor([rows[0]], [[true, true]]);
  expect(applyDropdown(rows, 0, masks).map((r) => r.primary)).toEqual(["a"]);
  expect(applyDropdown(rows, 0, undefined)).toEqual([]);
});

test("dropdown and segment subsets compose by AND", () => {
  const segments: SegmentMeta[] = [
    { label: "All", hasWhere: false },
    { label: "Open", hasWhere: true },
  ];
  const rows = [row("a"), row("b"), row("c"), row("d")];
  const segmentMasks: SegmentMasks = new WeakMap();
  rows.forEach((r, i) =>
    segmentMasks.set(r, [true, [true, true, false, false][i]]),
  );
  const dropdownMasks = masksFor(rows, [
    [true, false],
    [false, false],
    [true, false],
    [true, false],
  ]);

  const bySegment = applySegment(rows, 1, segments, segmentMasks);
  expect(
    applyDropdown(bySegment, 0, dropdownMasks).map((r) => r.primary),
  ).toEqual(["a"]);
  // All leaves the segment's own subset untouched.
  expect(applyDropdown(bySegment, -1, dropdownMasks)).toEqual(bySegment);
});
