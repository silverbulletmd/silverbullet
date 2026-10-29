import { cleanStringDate } from "@silverbulletmd/silverbullet/lib/json";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import YAML from "js-yaml";
import {
  type YamlSourceNode,
  yamlTopLevelEntries,
} from "../../plug-api/lib/yaml_source.ts";

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
    /** Top-level key order; only handlers whose objects are YAML take it */
    order?: string[],
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

const lineStart = (text: string, pos: number) =>
  text.lastIndexOf("\n", pos - 1) + 1;

const lineEnd = (text: string, pos: number) => {
  const end = text.indexOf("\n", pos);
  return end < 0 ? text.length : end;
};

/** Where the blank lines at the end of `text` start */
const trailingBlankStart = (text: string) =>
  /(?:\n[ \t\r]*)*$/.exec(text)!.index;

/**
 * A top-level key and its whole value, as whole lines, with the comment
 * lines directly above it.
 */
type KeyBlock = {
  key: string;
  /** The key's line up to and including its colon, as written */
  prefix: string;
  /** Start of the comment lines directly above the key */
  head: number;
  /** Start of the key's line */
  start: number;
  /** End of the value's last line, before its line break */
  end: number;
  value: YamlSourceNode;
};

function keyBlocks(yaml: string): KeyBlock[] {
  return yamlTopLevelEntries(yaml).map(({ key, keyNode, valueNode }) => {
    const start = lineStart(yaml, keyNode.from);
    if (yaml.slice(start, keyNode.from).trim() !== "") {
      throw new ObjectEditError("flow mappings must be edited in source");
    }
    const colon = yaml.indexOf(":", keyNode.to);
    // Edits are by line, so the key and its colon must share one
    if (
      keyNode.kind !== "scalar" ||
      yaml.slice(keyNode.from, colon).includes("\n")
    ) {
      throw new ObjectEditError("explicit YAML keys must be edited in source");
    }
    let head = start;
    while (head > 0 && yaml[lineStart(yaml, head - 1)] === "#") {
      head = lineStart(yaml, head - 1);
    }
    return {
      key,
      prefix: yaml.slice(start, colon + 1),
      head,
      start,
      end: lineEnd(yaml, Math.max(keyNode.to, valueNode.to - 1)),
      value: valueNode,
    };
  });
}

export type Quote = "double" | "single" | "plain";

/** How an existing value is written, so a rewrite looks the same. */
type ValueStyle = { quote: Quote; itemQuote: Quote; itemIndent: string };

const NEW_VALUE_STYLE: ValueStyle = {
  quote: "plain",
  itemQuote: "plain",
  itemIndent: "  ",
};

export function quoteOf(text: string | undefined): Quote {
  if (text?.startsWith('"')) return "double";
  if (text?.startsWith("'")) return "single";
  return "plain";
}

function styleOf(yaml: string, { value }: KeyBlock): ValueStyle {
  const source = (node: YamlSourceNode) => yaml.slice(node.from, node.to);
  if (value.kind === "sequence" && yaml[value.from] === "-") {
    return {
      quote: "plain",
      itemQuote: quoteOf(value.children[0] && source(value.children[0])),
      itemIndent: yaml.slice(lineStart(yaml, value.from), value.from),
    };
  }
  return { ...NEW_VALUE_STYLE, quote: quoteOf(source(value)) };
}

/** A scalar as YAML in the given quote style, or null if it isn't one. */
export function scalarYaml(value: unknown, quote: Quote): string | null {
  if (value instanceof Date) return cleanStringDate(value);
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") {
    return YAML.dump(value).trimEnd();
  }
  if (typeof value !== "string") return null;
  if (quote === "single" && !/[\n\r]/.test(value)) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  // A string YAML would read as another type (or can't write plain) is quoted
  if (
    quote === "plain" &&
    YAML.dump(value, { lineWidth: -1 }).trimEnd() === value
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function entryYaml(
  key: string,
  keyText: string,
  value: unknown,
  style: ValueStyle,
): string[] {
  const scalar = scalarYaml(value, style.quote);
  if (scalar !== null) return [`${keyText} ${scalar}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${keyText} []`];
    const items = value.map((v) => scalarYaml(v, style.itemQuote));
    if (items.every((i) => i !== null)) {
      return [keyText, ...items.map((i) => `${style.itemIndent}- ${i}`)];
    }
  }
  return YAML.dump({ [key]: value }, { lineWidth: -1 })
    .trimEnd()
    .split("\n");
}

/**
 * Moves top-level key blocks so the keys in `order` come first, in that
 * order; the other keys follow in their current order. A block is a key, its
 * value and the comment lines directly above it, and it moves as is.
 */
export function reorderKeys(yaml: string, order: string[]): string {
  const blocks = keyBlocks(yaml);
  if (blocks.length === 0) return yaml;
  const contentEnd = trailingBlankStart(yaml);
  // A block runs up to the next one, so blank lines travel with the block above
  const texts = new Map(
    blocks.map((block, i) => [
      block,
      yaml
        .slice(block.head, blocks[i + 1]?.head ?? contentEnd)
        .replace(/\n$/, ""),
    ]),
  );
  const ordered = new Set(
    order.flatMap((key) => blocks.filter((b) => b.key === key)),
  );
  for (const block of blocks) ordered.add(block);
  const body = [...ordered].map((block) => texts.get(block)).join("\n");
  // Blank lines that moved to the end would dangle; keep the text's own
  return (
    yaml.slice(0, blocks[0].head) +
    body.slice(0, trailingBlankStart(body)) +
    yaml.slice(contentEnd)
  );
}

/**
 * Sets and removes top-level keys in YAML text. A key's whole value is
 * replaced, nested lines included, written in the style of the value it
 * replaces; other lines are left as they are.
 */
export function patchYaml(
  yaml: string,
  patch: Record<string, unknown>,
  remove: string[],
  order?: string[],
): string {
  const blocks = new Map(keyBlocks(yaml).map((block) => [block.key, block]));
  const edits: TextEdit[] = [];
  const added: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (remove.includes(key)) continue;
    const block = blocks.get(key);
    if (!block) {
      const keyText = YAML.dump({ [key]: 0 })
        .trimEnd()
        .slice(0, -" 0".length);
      added.push(...entryYaml(key, keyText, value, NEW_VALUE_STYLE));
      continue;
    }
    // Emptying a key keeps it, with no value (`tags:`)
    const lines =
      value === null || value === undefined
        ? [block.prefix.trimEnd()]
        : entryYaml(key, block.prefix, value, styleOf(yaml, block));
    edits.push({ from: block.start, to: block.end, insert: lines.join("\n") });
  }
  for (const key of new Set(remove)) {
    const block = blocks.get(key);
    if (!block) continue;
    // Its comments go with it, as they move with it in reorderKeys; so does
    // one line break, the one before it when it's last
    edits.push(
      block.end < yaml.length
        ? { from: block.head, to: block.end + 1, insert: "" }
        : { from: Math.max(0, block.head - 1), to: block.end, insert: "" },
    );
  }
  if (added.length > 0) {
    const at = trailingBlankStart(yaml);
    edits.push({
      from: at,
      to: at,
      insert: (at > 0 ? "\n" : "") + added.join("\n"),
    });
  }
  const patched = applyEdits(yaml, edits);
  const out = order ? reorderKeys(patched, order) : patched;
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
