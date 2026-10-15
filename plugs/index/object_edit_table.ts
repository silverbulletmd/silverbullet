import {
  collectNodesOfType,
  findNodeOfType,
  type ParseTree,
} from "@silverbulletmd/silverbullet/lib/tree";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import {
  DERIVED,
  movedError,
  ObjectEditError,
  type ObjectHandler,
  type PlanContext,
  type TextEdit,
  wholeLines,
  withoutTag,
} from "./object_edit.ts";
import { cleanHeaderFieldName } from "./table.ts";

// Rows are rebuilt from their cell text: empty cells have no TableCell
// node, and rows may have fewer cells than the header
export function splitCells(line: string): string[] {
  const body = line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "|" && body[i - 1] !== "\\") {
      cells.push(current.trim());
      current = "";
    } else {
      current += body[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

function renderRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  return s.replace(/\r?\n/g, " ").replace(/(?<!\\)\|/g, "\\|");
}

function labelsOf(ctx: PlanContext, table: ParseTree): string[] {
  const header = findNodeOfType(table, "TableHeader")!;
  return splitCells(ctx.text.slice(header.from!, header.to!)).map(
    cleanHeaderFieldName,
  );
}

function column(labels: string[], key: string): number {
  const col = labels.indexOf(key);
  if (col < 0) {
    throw new ObjectEditError(`the table has no column "${key}"`);
  }
  return col;
}

function locateRow(ctx: PlanContext, found: ObjectValue<any>) {
  const row = collectNodesOfType(ctx.tree, "TableRow").find(
    (r) => r.from === found.range[0],
  );
  if (!row) throw movedError(found.page);
  const table = collectNodesOfType(ctx.tree, "Table").find(
    (t) => t.from! <= row.from! && row.to! <= t.to!,
  )!;
  return { row, labels: labelsOf(ctx, table) };
}

export function planTableUpdate(
  ctx: PlanContext,
  found: ObjectValue<any>,
  patch: Record<string, unknown>,
  remove: string[],
): TextEdit[] {
  const { row, labels } = locateRow(ctx, found);
  const cells = splitCells(ctx.text.slice(row.from!, row.to!));
  while (cells.length < labels.length) cells.push("");
  for (const [key, value] of Object.entries(patch)) {
    cells[column(labels, key)] = cellText(value);
  }
  for (const key of remove) cells[column(labels, key)] = "";
  return [{ from: row.from!, to: row.to!, insert: renderRow(cells) }];
}

export function planTableDelete(
  ctx: PlanContext,
  found: ObjectValue<any>,
): TextEdit[] {
  const { row } = locateRow(ctx, found);
  return [wholeLines(ctx.text, row.from!, row.to!)];
}

export function planTableAppend(
  ctx: PlanContext,
  record: Record<string, unknown>,
  anchor: string | undefined,
  tableRef: string | undefined,
): TextEdit[] {
  const tables = collectNodesOfType(ctx.tree, "Table");
  let table: ParseTree | undefined;
  if (tableRef !== undefined) {
    const pos = Number(tableRef.slice(tableRef.lastIndexOf("@") + 1));
    table = tables.find((t) => t.from === pos);
    if (!table) {
      throw new ObjectEditError(`no table at ${tableRef}`);
    }
  } else if (tables.length !== 1) {
    throw new ObjectEditError(
      tables.length === 0
        ? "the page has no table"
        : "the page has several tables; pass options.table",
    );
  } else {
    table = tables[0];
  }
  const labels = labelsOf(ctx, table);
  const values = withoutTag(record);
  for (const key of Object.keys(values)) column(labels, key);
  const cells = labels.map((l) => cellText(values[l]));
  // In a cell of its own past the last column, so no value includes it
  if (anchor) cells.push(`$${anchor}`);
  return [{ from: table.to!, to: table.to!, insert: `\n${renderRow(cells)}` }];
}

export const tableHandler: ObjectHandler = {
  readOnly: DERIVED,
  update: planTableUpdate,
  delete: planTableDelete,
};
