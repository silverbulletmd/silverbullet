import {
  clientStore,
  editor,
  index,
} from "@silverbulletmd/silverbullet/syscalls";
import type {
  LintDiagnostic,
  LintEvent,
} from "@silverbulletmd/silverbullet/type/client";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { allIndexers } from "./indexer.ts";
import { indexPage as pageIndexPage } from "./page.ts";
import { stringify as yamlStringify } from "./yaml.ts";

const STORE_KEY = "xray.enabled";

export type RangedEntry = {
  tag: string;
  object: ObjectValue & { range: [number, number] };
};

export type ObjectGroup = {
  tags: string[];
  object: ObjectValue & { range: [number, number] };
};

export function filterRangedEntries(
  entries: { tag: string; object: ObjectValue }[],
): RangedEntry[] {
  const out: RangedEntry[] = [];
  for (const e of entries) {
    const r = e.object.range;
    if (
      Array.isArray(r) &&
      r.length === 2 &&
      typeof r[0] === "number" &&
      typeof r[1] === "number"
    ) {
      out.push(e as RangedEntry);
    }
  }
  return out;
}

/**
 * Group consecutive entries that share the same logical object.
 * Identity by reference is unreliable across the syscall boundary
 * (objects are deserialized fresh), so we group by `(ref, range[0])`.
 */
export function groupByObject(entries: RangedEntry[]): ObjectGroup[] {
  const groups: ObjectGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.object.ref === entry.object.ref &&
      last.object.range[0] === entry.object.range[0] &&
      last.object.range[1] === entry.object.range[1]
    ) {
      last.tags.push(entry.tag);
    } else {
      groups.push({ tags: [entry.tag], object: entry.object });
    }
  }
  return groups;
}

export function renderObjectYaml(obj: ObjectValue): string {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    cleaned[k] = v;
  }
  return yamlStringify(cleaned as any, {
    sortKeys: false,
    lineWidth: 80,
    noRefs: true,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderGroupHtml(group: ObjectGroup): string {
  const head = escapeHtml(group.tags.join(", "));
  const body = escapeHtml(renderObjectYaml(group.object));
  return `<div class="sb-xray-card">` +
    `<h4 class="sb-xray-tooltip-tag">${head}</h4>` +
    `<pre class="sb-xray-tooltip-body">${body}</pre>` +
    `</div>`;
}

function renderGroupPlain(group: ObjectGroup): string {
  return `${group.tags.join(", ")}\n${renderObjectYaml(group.object)}`.trim();
}

/**
 * Lint subscriber: when X-Ray mode is enabled in the client store,
 * emits one `hint`-severity diagnostic per ranged object indexed for
 * the current page (multi-tag-expanded via the index pipeline). The
 * diagnostic's range underlines the source text and its `messageHtml`
 * fills the lint hover tooltip with a card showing the indexing tag(s)
 * and the object's attributes as YAML.
 */
export async function xrayInfo(
  { tree, name, pageMeta, text }: LintEvent,
): Promise<LintDiagnostic[]> {
  if (!await clientStore.get(STORE_KEY)) return [];
  if (!pageMeta) return [];

  const frontmatter = extractFrontMatter(tree);
  // Run every indexer except `pageIndexPage` (which would emit a `page`
  // object covering the entire document and add noise).
  const indexResults = await Promise.all(
    allIndexers
      .filter((indexer) => indexer !== pageIndexPage)
      .map((indexer) => indexer(pageMeta, frontmatter, tree, text)),
  );
  const raw = indexResults.flat() as ObjectValue[];

  const entries = await index.previewProcessedObjects(name, raw);
  const ranged = filterRangedEntries(entries);
  const groups = groupByObject(ranged);

  return groups.map((group): LintDiagnostic => ({
    from: group.object.range[0],
    to: group.object.range[1],
    severity: "hint",
    message: renderGroupPlain(group),
    messageHtml: renderGroupHtml(group),
    markClass: "sb-xray-range",
  }));
}

/**
 * Toggle the X-Ray mode flag in the client store and force the linter
 * to re-run so the change is visible immediately. Wired as the
 * `Editor: Toggle X-Ray` command in `index.plug.yaml`.
 */
export async function toggleXRayMode(): Promise<void> {
  const next = !(await clientStore.get(STORE_KEY));
  await clientStore.set(STORE_KEY, next);
  await editor.forceLint();
}
