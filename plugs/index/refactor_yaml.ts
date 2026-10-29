import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import { collectNodesOfType } from "@silverbulletmd/silverbullet/lib/tree";
import YAML from "js-yaml";
import { dataBlocks } from "./data.ts";
import { yamlNodes, yamlSource } from "../../plug-api/lib/yaml_source.ts";
import { quoteOf, scalarYaml } from "./object_edit.ts";

export type Splice = {
  range: [number, number];
  /** Returns `text` with the reference at `range` rewritten */
  apply(text: string): string;
};

/** The spans of a page that hold YAML: its frontmatter and data blocks. */
export function yamlRegions(tree: ParseTree): [number, number][] {
  return [
    ...collectNodesOfType(tree, "FrontMatter"),
    ...dataBlocks(tree).flatMap((b) => (b.code ? [b.code] : [])),
  ].map((n) => [n.from!, n.to!]);
}

/** The parsed scalar containing this reference, excluding trailing comments. */
function scalarAt(
  text: string,
  range: [number, number],
  regions: [number, number][],
): [number, number] | null {
  const region = regions.find(
    ([from, to]) => from <= range[0] && range[1] <= to,
  );
  if (!region) return null;
  try {
    const yaml = text.slice(region[0], region[1]);
    const source = (node: { from: number; to: number }) =>
      yaml.slice(node.from, node.to);
    const around = yamlSource(yaml)
      .flatMap(yamlNodes)
      .filter(
        (node) =>
          region[0] + node.from <= range[0] && range[1] <= region[0] + node.to,
      );
    // Flow collections and multiline values keep the conservative rename
    // fallback; scalarYaml can't preserve their layout.
    if (around.some((node) => /^[{[]/.test(source(node)))) return null;
    const node = around.find(
      (node) => node.kind === "scalar" && !source(node).includes("\n"),
    );
    return node ? [region[0] + node.from, region[0] + node.to] : null;
  } catch {
    return null;
  }
}

function loadScalar(raw: string): unknown {
  try {
    return YAML.load(raw);
  } catch {
    return undefined;
  }
}

/** Where the scalar ends and its trailing whitespace and `# comment` begin. */
function valueEnd(raw: string): number {
  const quote = raw[0];
  if (quote === '"' || quote === "'") {
    for (let i = 1; i < raw.length; i++) {
      if (quote === '"' && raw[i] === "\\") i++;
      else if (raw[i] === quote) {
        if (quote === "'" && raw[i + 1] === "'") i++;
        else return i + 1;
      }
    }
    return raw.length;
  }
  const comment = /\s+#/.exec(raw);
  return comment ? comment.index : raw.trimEnd().length;
}

/**
 * `newRaw` if it still reads as the old value with the links replaced,
 * otherwise that value written again: in the old quote style when it can
 * be, else double-quoted. A trailing comment is kept.
 */
function validScalar(
  oldRaw: string,
  newRaw: string,
  replaced: [string, string][],
): string {
  const old = loadScalar(oldRaw);
  if (typeof old !== "string") return newRaw;
  let expected = old;
  for (const [from, to] of replaced) expected = expected.replaceAll(from, to);
  if (loadScalar(newRaw) === expected) return newRaw;
  const end = valueEnd(oldRaw);
  // The comment and spacing after the value stay, with any link in them updated
  let rest = oldRaw.slice(end);
  for (const [from, to] of replaced) rest = rest.replaceAll(from, to);
  return scalarYaml(expected, quoteOf(oldRaw.trim()))! + rest;
}

/** Each applied splice's reference text, before and after */
type Replaced = [string, string][];

/** Applies one splice, recording the reference text it replaced */
function applyOne(text: string, splice: Splice, replaced: Replaced): string {
  const [from, to] = splice.range;
  const after = splice.apply(text);
  replaced.push([
    text.slice(from, to),
    after.slice(from, to + after.length - text.length),
  ]);
  return after;
}

/** The splices of one YAML region, applied with their values kept valid */
function applyInRegion(
  text: string,
  sorted: Splice[],
  regions: [number, number][],
): { text: string; replaced: Replaced } {
  const source = text;
  const replacedOut: Replaced = [];
  let i = 0;
  while (i < sorted.length) {
    const scalar = scalarAt(source, sorted[i].range, regions);
    if (!scalar) {
      text = applyOne(text, sorted[i], replacedOut);
      i++;
      continue;
    }
    // Every link in the same value, so it's re-quoted once
    const replaced: Replaced = [];
    let next = text;
    for (; i < sorted.length && sorted[i].range[0] >= scalar[0]; i++) {
      next = applyOne(next, sorted[i], replaced);
    }
    replacedOut.push(...replaced);
    const end = scalar[1] + next.length - text.length;
    text =
      next.slice(0, scalar[0]) +
      validScalar(
        text.slice(scalar[0], scalar[1]),
        next.slice(scalar[0], end),
        replaced,
      ) +
      next.slice(end);
  }
  return { text, replaced: replacedOut };
}

const FENCE_LINE = /^---\s*$/;

/** The YAML of a region, without the `---` lines of frontmatter. */
function regionYaml(region: string): string {
  const lines = region.split("\n");
  if (lines.length > 1 && FENCE_LINE.test(lines[0])) lines.shift();
  if (lines.length > 0 && FENCE_LINE.test(lines[lines.length - 1])) lines.pop();
  return lines.join("\n");
}

function mapStrings(value: unknown, replaced: Replaced): unknown {
  const map = (str: string) => {
    for (const [from, to] of replaced) str = str.replaceAll(from, to);
    return str;
  };
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, replaced));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [map(k), mapStrings(v, replaced)]),
    );
  }
  return value;
}

/**
 * True if the YAML still parses and reads as the old one with only the
 * renamed links changed.
 */
function regionIntact(
  before: string,
  after: string,
  replaced: Replaced,
): boolean {
  let old: unknown;
  try {
    old = YAML.load(regionYaml(before));
  } catch {
    return true; // already broken: nothing to protect
  }
  try {
    const expected = mapStrings(old, replaced);
    return (
      JSON.stringify(YAML.load(regionYaml(after))) === JSON.stringify(expected)
    );
  } catch {
    return false;
  }
}

/**
 * Applies the splices from the end of `text` backwards. A splice inside a
 * YAML value would otherwise splice link text into it unescaped (a `'` in a
 * single-quoted value, a `: ` in a plain one), breaking the whole YAML.
 * The splices of a YAML region are kept only if the region still parses to
 * the same values (apart from the links); otherwise the region is left as it
 * was, since the rename must never corrupt it. The other splices still apply.
 * `changed` counts the kept splices that changed their reference.
 */
export function applySplices(
  text: string,
  splices: Splice[],
  regions: [number, number][],
): { text: string; changed: number } {
  const sorted = [...splices].sort((a, b) => b.range[0] - a.range[0]);
  const regionOf = (s: Splice) =>
    regions.findIndex(([from, to]) => from <= s.range[0] && s.range[1] <= to);
  const kept: Replaced = [];
  let i = 0;
  while (i < sorted.length) {
    const r = regionOf(sorted[i]);
    if (r < 0) {
      text = applyOne(text, sorted[i], kept);
      i++;
      continue;
    }
    const group: Splice[] = [];
    for (; i < sorted.length && regionOf(sorted[i]) === r; i++) {
      group.push(sorted[i]);
    }
    const [from, to] = regions[r];
    const { text: next, replaced } = applyInRegion(text, group, regions);
    const nextTo = to + next.length - text.length;
    if (
      regionIntact(text.slice(from, to), next.slice(from, nextTo), replaced)
    ) {
      text = next;
      kept.push(...replaced);
    } else {
      console.warn(
        "Rename left a YAML block unchanged, because rewriting its links would break it",
      );
    }
  }
  return {
    text,
    changed: kept.filter(([before, after]) => before !== after).length,
  };
}
