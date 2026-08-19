import type { DropdownOption, Row } from "../types.ts";

/** Per-row `where` results, parallel to the view's dropdown options. */
export type DropdownMasks = WeakMap<Row, boolean[]>;

/** The option a selected value names, or -1 (the built-in "All") when it
 * names none -- including a persisted value the options no longer carry. */
export function dropdownIndexFor(
  options: DropdownOption[] | undefined,
  value: unknown,
): number {
  if (!options?.length || value === undefined || value === null) return -1;
  return options.findIndex((o) => o.value === value);
}

/**
 * The rows the selected option admits. "All" (index -1) is a pass-through; a
 * selected option whose masks never arrived (a failed batch, an object added
 * since the last load) drops the row -- the same fail-closed rule segment
 * `where` masks follow.
 */
export function applyDropdown(
  rows: Row[],
  index: number,
  masks?: DropdownMasks,
): Row[] {
  if (index < 0) return rows;
  if (!masks) return [];
  return rows.filter((row) => masks.get(row)?.[index] === true);
}
