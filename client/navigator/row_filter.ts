import { descriptionText } from "../../plug-api/ui/description.ts";
import { rank } from "../../plug-api/lib/fuzzy.ts";
import type { FilterFields, Row } from "./types.ts";

const DEFAULT_FILTER_FIELDS: FilterFields = {
  primary: { weight: 1.0, segments: true },
  description: 0.5,
};

export type IndexedViewRow = Record<string, any> & {
  __row: Row;
  __idx: number;
};

export function indexViewRows(rows: Row[]): IndexedViewRow[] {
  return rows.map((row, index) => ({
    ...row.obj,
    primary: row.primary,
    description: descriptionText(row.description),
    __row: row,
    __idx: index,
  }));
}

export function rankViewRows(
  rows: IndexedViewRow[],
  phrase: string,
  fields?: FilterFields,
): { row: Row; score: number }[] {
  return rank(rows, phrase, {
    fields: fields ?? DEFAULT_FILTER_FIELDS,
    orderId: (row) => row.__idx,
  }).map((entry) => ({ row: entry.__row, score: entry.score }));
}
