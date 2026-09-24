import { parseToRef } from "../../plug-api/lib/ref.ts";
import { wikiLinkRegex } from "../markdown_parser/constants.ts";
import { isSafeUrl } from "../markdown_renderer/sanitize_html.ts";
import type { Row, TableColumn, TableColumnType } from "./types.ts";

export function inferColumns(rows: Row[]): TableColumn[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row.obj)))].map(
    (attribute) => ({ attribute, label: attribute }),
  );
}

function stableJson(value: unknown): string {
  return (
    JSON.stringify(value, (_key, entry) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        return Object.fromEntries(
          Object.keys(entry)
            .sort()
            .map((key) => [key, entry[key]]),
        );
      }
      return entry;
    }) ?? ""
  );
}

const singleWikiLink = new RegExp(wikiLinkRegex.source);
const numberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 20,
});

function referenceValue(value: unknown): { markdown: string } | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const text = value.trim();
  const markdown = text.startsWith("[[") ? text : `[[${text}]]`;
  const match = singleWikiLink.exec(markdown);
  if (!match || match[0] !== markdown || match.groups?.leadingTrivia !== "[[")
    return undefined;
  const ref = parseToRef(match.groups.stringRef);
  return ref ? { markdown } : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "true") return true;
    if (text === "false") return false;
  }
  return undefined;
}

function urlValue(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || !isSafeUrl(value, true))
    return undefined;
  try {
    new URL(value);
    return value.trim();
  } catch {
    return undefined;
  }
}

function literalText(value: unknown): string {
  return typeof value === "object" ? stableJson(value) : String(value);
}

export type TableValuePart = {
  text: string;
  markdown: boolean;
  url?: string;
  boolean?: boolean;
};

export function tableValueParts(
  value: unknown,
  type?: TableColumnType,
): TableValuePart[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => [
      ...(index ? [{ text: ", ", markdown: false }] : []),
      ...tableValueParts(entry, type),
    ]);
  }
  const text = literalText(value);
  switch (type) {
    case "ref": {
      const ref = referenceValue(value);
      return [{ text: ref?.markdown ?? text, markdown: !!ref }];
    }
    case "number": {
      const number = numberValue(value);
      return [
        {
          text: number === undefined ? text : numberFormat.format(number),
          markdown: false,
        },
      ];
    }
    case "boolean": {
      const boolean = booleanValue(value);
      return [
        {
          text: boolean === undefined ? text : String(boolean),
          markdown: false,
          ...(boolean === undefined ? {} : { boolean }),
        },
      ];
    }
    case "url": {
      const url = urlValue(value);
      return [{ text, markdown: false, ...(url ? { url } : {}) }];
    }
    case "text":
      return [{ text, markdown: false }];
    default:
      return [{ text, markdown: typeof value === "string" }];
  }
}
