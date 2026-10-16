import {
  entrySource,
  isErrorEntry,
  type LogEntry,
  type LogSource,
} from "./console_log.ts";
import { previewValue } from "./value_preview.ts";

// Entries are immutable, so each one's text only needs computing once
const textCache = new WeakMap<LogEntry, string>();

const previewArg = (a: unknown) =>
  typeof a === "string" ? a : previewValue(a, { depth: 2 });

export function entryText(e: LogEntry): string {
  let text = textCache.get(e);
  if (text === undefined) {
    switch (e.kind) {
      case "input":
        text = e.code;
        break;
      case "result":
        text = e.values.map(previewArg).join(" ");
        break;
      case "stopped":
        text = "Stopped";
        break;
      case "message":
        text = e.args.map(previewArg).join(" ");
        break;
    }
    textCache.set(e, text);
  }
  return text;
}

export type SourceFilter = "all" | LogSource | "error";

function matchesSource(e: LogEntry, source: SourceFilter): boolean {
  switch (source) {
    case "all":
      return true;
    case "error":
      return isErrorEntry(e);
    default:
      return entrySource(e) === source;
  }
}

// A plug's name is searchable, though it isn't part of the entry's text
function matchesText(e: LogEntry, needle: string): boolean {
  if (e.kind === "message" && e.scope?.toLowerCase().includes(needle)) {
    return true;
  }
  return entryText(e).toLowerCase().includes(needle);
}

export function filterEntries(
  entries: LogEntry[],
  text: string,
  source: SourceFilter = "all",
): LogEntry[] {
  const needle = text.trim().toLowerCase();
  if (!needle && source === "all") return entries;
  return entries.filter(
    (e) =>
      matchesSource(e, source) &&
      (!needle || matchesText(e, needle)),
  );
}
