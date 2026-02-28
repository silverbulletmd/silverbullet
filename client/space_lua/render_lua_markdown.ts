import { luaFormatNumber, LuaTable } from "../space_lua/runtime.ts";
import { isTaggedFloat } from "../space_lua/numeric.ts";

function isMultiLine(str: string): boolean {
  return /\n/.test(str.trim());
}

// Indent all but the first line
function indentExceptFirstLine(md: string, indent: string): string {
  const lines = md.replace(/^\n+/, "").replace(/\n+$/, "").split("\n");
  return lines[0] +
    (lines.length > 1
      ? "\n" + lines.slice(1).map((line) => indent + line).join("\n")
      : "");
}

// Simple transformers for Markdown rendering
export function defaultTransformer(v: any, _k: string): Promise<string> {
  if (v === undefined) return Promise.resolve("");
  if (typeof v === "string") {
    return Promise.resolve(escapeRegularPipes(v.replaceAll("\n", " ")));
  }
  if (v && typeof v === "object") return Promise.resolve(luaTableString(v));
  if (typeof v === "number") return Promise.resolve(luaFormatNumber(v));
  return Promise.resolve("" + v);
}

export function refCellTransformer(v: any, k: string) {
  if (k === "ref") return Promise.resolve(`[[${v}]]`);
  return defaultTransformer(v, k);
}

function escapeRegularPipes(s: string) {
  let result = "", isInWikiLink = false, isInCommandButton = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "[" && s[i + 1] === "[") isInWikiLink = true;
    else if (s[i] === "]" && s[i + 1] === "]" && isInWikiLink) {
      isInWikiLink = false;
    }
    if (s[i] === "{" && s[i + 1] === "[") isInCommandButton = true;
    else if (
      (s[i] === "]" || s[i] === ")") && s[i + 1] === "}" && isInCommandButton
    ) isInCommandButton = false;
    else if (s[i] === "|" && !isInWikiLink && !isInCommandButton) {
      result += "\\";
    }
    result += s[i];
  }
  return result;
}

function isPlainObject(v: any): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v) &&
    v.constructor === Object;
}

function isLuaRecordLike(tbl: LuaTable): boolean {
  for (const k of tbl.keys()) if (typeof k === "string") return true;
  return false;
}

export async function renderExpressionResult(
  result: any,
  cellTransformer: (v: any, k: string) => Promise<string> = defaultTransformer,
  listLevel = 0,
): Promise<string> {
  if (result === undefined || result === null) return "nil";
  if (isTaggedFloat(result)) return luaFormatNumber(result.value, "float");
  if (typeof result === "number") return luaFormatNumber(result);

  if (result instanceof LuaTable) {
    return renderLuaTable(result, cellTransformer, listLevel);
  }

  if (Array.isArray(result)) {
    if (result.length === 0) return "*(empty table)*";
    if (result.every(isPlainObject)) {
      return await jsonToMDTable(result, cellTransformer);
    }

    const items = await Promise.all(result.map(async (item) => {
      if (item instanceof LuaTable) {
        const keysLength = item.keys().length;
        const arrayLength = item.length;
        if (keysLength > 0 && arrayLength === 0) {
          const tableMd = await renderLuaTable(
            item,
            cellTransformer,
            listLevel + 1,
          );
          return tableMd.trimEnd();
        }
        if (keysLength > 0 && arrayLength > 0) {
          const tableMd = await renderLuaTable(
            item,
            cellTransformer,
            listLevel + 1,
          );
          return tableMd.trimEnd();
        }
        if (arrayLength > 0 && keysLength === 0) {
          const sublist = await renderExpressionResult(
            item,
            cellTransformer,
            listLevel + 1,
          );
          return sublist.trimEnd();
        }
        return await renderExpressionResult(
          item,
          cellTransformer,
          listLevel + 1,
        );
      }
      if (Array.isArray(item) && item.length > 0) {
        const sublist = await renderExpressionResult(
          item,
          cellTransformer,
          listLevel + 1,
        );
        return sublist.trimEnd();
      }
      if (isPlainObject(item) && Object.keys(item).length > 0) {
        const tableMd = await jsonToMDTable([item], cellTransformer);
        return tableMd.trimEnd();
      }
      return `${await renderExpressionResult(
        item,
        cellTransformer,
        listLevel + 1,
      )}`.trimEnd();
    }));

    const childIndent = "  ".repeat(listLevel + 1);

    return items.map((item) => {
      if (isMultiLine(item)) {
        return `- ${indentExceptFirstLine(item, childIndent)}`;
      }
      return `- ${item}`;
    }).join("\n");
  }

  if (isPlainObject(result)) {
    if (Object.keys(result).length === 0) return "*(empty table)*";
    return jsonToMDTable([result], cellTransformer);
  }
  return "" + result;
}

async function renderLuaTable(
  tbl: LuaTable,
  cellTransformer: (v: any, k: string) => Promise<string>,
  listLevel = 0,
): Promise<string> {
  const keys = tbl.keys();
  if (keys.length === 0) return "*(empty table)*";
  const arrayLen = tbl.length;
  const stringKeys: string[] = [];
  for (const k of keys) if (typeof k === "string") stringKeys.push(k);

  const hasArrayPart = arrayLen > 0, hasStringKeys = stringKeys.length > 0;

  if (hasArrayPart && !hasStringKeys) {
    const elements: any[] = [];
    for (let i = 1; i <= arrayLen; i++) elements.push(tbl.rawGet(i));
    if (
      elements.every((el) => el instanceof LuaTable) &&
      elements.some((el) => isLuaRecordLike(el as LuaTable))
    ) {
      return renderLuaTableArray(elements as LuaTable[], cellTransformer);
    }
    const items = await Promise.all(
      elements.map((el) =>
        renderExpressionResult(el, cellTransformer, listLevel + 1)
      ),
    );
    const childIndent = "  ".repeat(listLevel + 1);
    return items.map((item) => {
      if (isMultiLine(item)) {
        return `- ${indentExceptFirstLine(item, childIndent)}`;
      }
      return `- ${item}`;
    }).join("\n");
  }

  if (hasStringKeys && !hasArrayPart) {
    return renderLuaRecordTable(tbl, stringKeys, cellTransformer);
  }

  const allHeaders: string[] = [];
  for (let i = 1; i <= arrayLen; i++) allHeaders.push(String(i));
  allHeaders.push(...stringKeys);
  return renderLuaMixedTable(tbl, allHeaders, arrayLen, cellTransformer);
}

export async function renderLuaTableArray(
  tables: LuaTable[],
  cellTransformer: (v: any, k: string) => Promise<string>,
): Promise<string> {
  const headers = new Set<string>();
  for (const tbl of tables) for (const k of tbl.keys()) headers.add(String(k));
  if (headers.size === 0) return "*(empty table)*";
  const headerList = [...headers];
  const lines: string[] = [
    "|" + headerList.join("|") + "|",
    "|" + headerList.map(() => "--").join("|") + "|",
  ];
  for (const tbl of tables) {
    const cells: string[] = [];
    for (const h of headerList) {
      const key = /^\d+$/.test(h) ? Number(h) : h;
      const v = tbl.rawGet(key);
      cells.push(await renderLuaCellValue(v, h, cellTransformer));
    }
    lines.push("|" + cells.join("|") + "|");
  }
  return lines.join("\n");
}

export async function renderLuaRecordTable(
  tbl: LuaTable,
  keys: string[],
  cellTransformer: (v: any, k: string) => Promise<string>,
): Promise<string> {
  const lines: string[] = [
    "|" + keys.join("|") + "|",
    "|" + keys.map(() => "--").join("|") + "|",
  ];
  const cells: string[] = [];
  for (const k of keys) {
    cells.push(await renderLuaCellValue(tbl.rawGet(k), k, cellTransformer));
  }
  lines.push("|" + cells.join("|") + "|");
  return lines.join("\n");
}

export async function renderLuaMixedTable(
  tbl: LuaTable,
  headers: string[],
  arrayLen: number,
  cellTransformer: (v: any, k: string) => Promise<string>,
): Promise<string> {
  const lines: string[] = [
    "|" + headers.join("|") + "|",
    "|" + headers.map(() => "--").join("|") + "|",
  ];
  const cells: string[] = [];
  for (const h of headers) {
    const idx = Number(h);
    const key = idx >= 1 && idx <= arrayLen ? idx : h;
    cells.push(await renderLuaCellValue(tbl.rawGet(key), h, cellTransformer));
  }
  lines.push("|" + cells.join("|") + "|");
  return lines.join("\n");
}

export async function renderLuaCellValue(
  v: any,
  key: string,
  cellTransformer: (v: any, k: string) => Promise<string>,
): Promise<string> {
  if (v === undefined || v === null) return "";
  if (v instanceof LuaTable) {
    const str = await v.toStringAsync();
    return escapeRegularPipes(str.replaceAll("\n", " "));
  }
  return cellTransformer(v, key);
}

export async function jsonToMDTable(
  jsonArray: any[],
  valueTransformer: (v: any, k: string) => Promise<string> = defaultTransformer,
): Promise<string> {
  const headers = new Set<string>();
  for (const entry of jsonArray) {
    for (const k of Object.keys(entry)) headers.add(k);
  }
  if (headers.size === 0) return "*(empty table)*";

  const headerList = [...headers];
  const lines = [
    "|" + headerList.join("|") + "|",
    "|" + headerList.map(() => "--").join("|") + "|",
  ];
  for (const val of jsonArray) {
    const el = [];
    for (const prop of headerList) {
      el.push(await valueTransformer(val[prop], prop));
    }
    lines.push("|" + el.join("|") + "|");
  }
  return lines.join("\n");
}

function luaTableString(tbl: any): string {
  if (tbl && typeof tbl.toStringAsync === "function") return "(table)";
  return "" + tbl;
}
