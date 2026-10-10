import { buildTree, type TreeNode } from "../../plug-api/ui/tree_model.ts";
import type { PortableMarkdownResult } from "../markdown_renderer/compose.ts";
import {
  escapeRegularPipes,
  gfmTable,
} from "../markdown_renderer/result_render.ts";
import type { LuaEnv } from "../space_lua/runtime.ts";
import { luaHandle } from "./lua_views.ts";
import { inferColumns, tableValueParts } from "./table_model.ts";
import type { Row, TableColumn, ViewMeta } from "./types.ts";
import type { ViewValue } from "./view_value.ts";

function cellText(row: Row, col: TableColumn, index: number): string {
  const value = row.cells ? row.cells[index] : row.obj[col.attribute ?? ""];
  return escapeRegularPipes(
    tableValueParts(value, col.type)
      .map((p) => p.text)
      .join("")
      .replace(/\r?\n/g, " "),
  );
}

const oneLine = (text: unknown) => String(text ?? "").replace(/\r?\n/g, " ");

function treeLines(node: TreeNode, depth: number, out: string[]): void {
  for (const child of node.children) {
    out.push(
      `${"  ".repeat(depth)}* ${oneLine(child.row?.label ?? child.segment)}`,
    );
    treeLines(child, depth + 1, out);
  }
}

export function rowsToMarkdown(
  rows: Row[],
  meta: Pick<ViewMeta, "mode" | "columns"> &
    Partial<Pick<ViewMeta, "hierarchy" | "foldersFirst">>,
): string {
  if (meta.mode === "tree" && meta.hierarchy) {
    const out: string[] = [];
    treeLines(
      buildTree(rows, meta.hierarchy.separator, meta.foldersFirst ?? false),
      0,
      out,
    );
    return out.join("\n");
  }
  if (meta.mode !== "table") {
    return rows.map((row) => `* ${oneLine(row.primary)}`).join("\n");
  }
  const columns = meta.columns ?? inferColumns(rows);
  return gfmTable(
    columns.map((c) => escapeRegularPipes(c.label)),
    rows.map((row) => columns.map((c, i) => cellText(row, c, i))),
  );
}

/** A list/tree/table view's rows as Markdown (its Copy text). */
export async function viewRowsMarkdown(
  view: ViewValue,
  env: LuaEnv,
): Promise<PortableMarkdownResult> {
  const rows = await luaHandle(
    view.spec,
    "rows",
    { ctx: { phrase: "", dock: "inline" } },
    env,
  );
  if (!Array.isArray(rows)) {
    return { ok: false, reason: `Could not copy: ${rows?.error ?? "no rows"}` };
  }
  return { ok: true, markdown: rowsToMarkdown(rows, view.meta) };
}
