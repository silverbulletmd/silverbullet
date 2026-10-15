import YAML from "js-yaml";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";

export type TextEdit = { from: number; to: number; insert: string };

export type ObjectTarget = {
  page: string;
  ref: string;
  tag?: string;
  range?: [number, number];
  text?: string;
} & Record<string, unknown>;

/** Objects that live inside a page's text (pages themselves are separate). */
export type ObjectKind = "task" | "item" | "paragraph" | "data" | "table";

export type PlanContext = { text: string; tree: ParseTree };

export type ObjectHandler = {
  readOnly: string[];
  update(
    ctx: PlanContext,
    found: ObjectValue<any>,
    patch: Record<string, unknown>,
    remove: string[],
  ): TextEdit[];
  delete(ctx: PlanContext, found: ObjectValue<any>): TextEdit[];
};

/** Messages carry no prefix; the syscall entry point adds its name. */
export class ObjectEditError extends Error {}

export function applyEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from < sorted[i - 1].to) {
      throw new ObjectEditError(
        "these changes overlap; change the objects one at a time",
      );
    }
  }
  let out = text;
  for (const e of sorted.reverse()) {
    out = out.slice(0, e.from) + e.insert + out.slice(e.to);
  }
  return out;
}

export function editedSpans(edits: TextEdit[]): [number, number][] {
  let delta = 0;
  return [...edits]
    .sort((a, b) => a.from - b.from)
    .map((e) => {
      const from = e.from + delta;
      delta += e.insert.length - (e.to - e.from);
      return [from, from + e.insert.length];
    });
}

export function minimalEdit(before: string, after: string): TextEdit[] {
  if (before === after) return [];
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start++;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  return [{ from: start, to: endBefore, insert: after.slice(start, endAfter) }];
}

/** Widens a span to whole lines, including the line break after it. */
export function wholeLines(text: string, from: number, to: number): TextEdit {
  return {
    from: text.lastIndexOf("\n", from - 1) + 1,
    to: text[to] === "\n" ? to + 1 : to,
    insert: "",
  };
}

/** Where `end` would be with the whitespace before it removed. */
export function trimmedEnd(text: string, end = text.length): number {
  let from = end;
  while (from > 0 && /\s/.test(text[from - 1])) from--;
  return from;
}

export function withoutTag(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const { tag: _tag, ...values } = record;
  return values;
}

// The attribute syntax ends at the first `]`, even inside quotes, so
// brackets in strings are written as YAML escapes
function escapeBrackets(json: string): string {
  return json.replace(/"(?:[^"\\]|\\.)*"/g, (s) =>
    s.replace(/\[/g, "\\u005b").replace(/\]/g, "\\u005d"),
  );
}

/** A value as single-line YAML, for `[key: value]` attributes. */
export function inlineYaml(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    // A string YAML would read as a date, number or boolean must be quoted
    const plain = YAML.dump(value, { lineWidth: -1 }).trimEnd();
    if (plain === value && !/[[\]]/.test(value)) return value;
  }
  return escapeBrackets(JSON.stringify(value));
}

function topLevelKey(line: string): string | null {
  const m = /^(?:"([^"]*)"|'([^']*)'|([^\s#'"?:-][^:]*?))\s*:(?:\s|$)/.exec(
    line,
  );
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/**
 * Sets and removes top-level keys in YAML text. A key's whole value is
 * replaced, nested lines included; other lines are left as they are.
 */
export function patchYaml(
  yaml: string,
  patch: Record<string, unknown>,
  remove: string[],
): string {
  const lines = yaml === "" ? [] : yaml.split("\n");
  const extent = (start: number) => {
    let end = start + 1;
    while (
      end < lines.length &&
      (lines[end] === "" || /^[\s-]/.test(lines[end]))
    ) {
      end++;
    }
    while (end > start + 1 && lines[end - 1].trim() === "") end--;
    return end;
  };
  const replace = (key: string, replacement: string[]) => {
    const start = lines.findIndex((l) => topLevelKey(l) === key);
    if (start >= 0) {
      lines.splice(start, extent(start) - start, ...replacement);
    } else {
      lines.push(...replacement);
    }
  };
  for (const [key, value] of Object.entries(patch)) {
    replace(
      key,
      YAML.dump({ [key]: value }, { lineWidth: -1 })
        .trimEnd()
        .split("\n"),
    );
  }
  for (const key of remove) replace(key, []);
  const out = lines.join("\n");
  try {
    YAML.load(out);
  } catch (e: any) {
    throw new ObjectEditError(
      `this change would leave invalid YAML (${e.message})`,
    );
  }
  return out;
}

export function kindOf(o: {
  tag?: string;
  itags?: string[];
}): ObjectKind | null {
  switch (o.tag) {
    case "task":
    case "item":
    case "paragraph":
    case "table":
      return o.tag;
  }
  return o.itags?.includes("data") ? "data" : null;
}

export function isPageTarget(t: ObjectTarget): boolean {
  return t.tag === "page" || (!t.range && t.ref === t.page);
}

export function isPositionRef(ref: string): boolean {
  return /@\d+$/.test(ref);
}

export function movedError(page: string): ObjectEditError {
  return new ObjectEditError(
    `object moved or was removed from ${page}, query again`,
  );
}

// Keys that identify an object or are computed by the indexer, so a
// changed value doesn't mean a different object
const IDENTITY_KEYS = new Set([
  "ref",
  "tag",
  "tags",
  "itags",
  "page",
  "pos",
  "toPos",
  "range",
  "pageLastModified",
  "parent",
  "links",
  "ilinks",
  "tableref",
]);

function hasFingerprint(target: ObjectTarget): boolean {
  return (
    typeof target.text === "string" ||
    Object.keys(target).some((k) => !IDENTITY_KEYS.has(k))
  );
}

function sameObject(found: ObjectValue<any>, target: ObjectTarget): boolean {
  if (typeof target.text === "string" && typeof found.text === "string") {
    return found.text === target.text;
  }
  for (const [key, value] of Object.entries(target)) {
    if (IDENTITY_KEYS.has(key) || !(key in found)) continue;
    if (JSON.stringify(found[key]) !== JSON.stringify(value)) return false;
  }
  return true;
}

/**
 * The object in `fresh` (the page's current objects) that `target` (an
 * object from a possibly older query) refers to.
 */
export function findTarget(
  fresh: ObjectValue<any>[],
  target: ObjectTarget,
): ObjectValue<any> {
  const positional = isPositionRef(target.ref);
  if (positional && !hasFingerprint(target)) {
    throw new ObjectEditError(
      `${target.ref} is a position; pass the object from a query, or give it an anchor`,
    );
  }
  const found = fresh.find(
    (o) =>
      o.ref === target.ref &&
      kindOf(o) !== null &&
      (!target.tag || o.tag === target.tag),
  );
  if (!found) {
    throw positional
      ? movedError(target.page)
      : new ObjectEditError(`${target.page} has no object $${target.ref}`);
  }
  if (positional && !sameObject(found, target)) {
    throw movedError(target.page);
  }
  return found;
}

export const DERIVED = [
  "ref",
  "tag",
  "itags",
  "page",
  "pos",
  "toPos",
  "range",
  "links",
  "ilinks",
  "parent",
  "pageLastModified",
  "tableref",
];

export function checkWritable(
  kind: string,
  readOnly: string[],
  keys: string[],
): void {
  const bad = keys.find((k) => readOnly.includes(k));
  if (bad) {
    throw new ObjectEditError(`"${bad}" can't be changed on a ${kind}`);
  }
}

export function pageMetaFor(page: string): PageMeta {
  return {
    ref: page,
    tag: "page",
    name: page,
    perm: "rw",
    lastModified: "",
    created: "",
  };
}
