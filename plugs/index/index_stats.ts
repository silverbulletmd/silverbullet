// Run with `npm run index-stats`.
//
// Indexes every Markdown page under `silverbullet/website/` and reports
// total indexer wall time (mean over a few runs) and object counts
// grouped by tag, with a sub-breakdown of relation records by kind.
//
// Parsing is hoisted out of the timing loop so the reported time
// reflects the indexer pipeline itself, not Lezer parsing.

import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { extractFrontMatter, type FrontMatter } from "./frontmatter.ts";
import { allIndexers } from "./indexer.ts";
import {
  type CorpusPage,
  loadMarkdownFiles,
  stubPageMeta,
  websiteDir,
} from "./test_corpus.ts";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";

createMockSystem();

// Suppress link.ts's per-broken-link `console.info` noise for the
// duration of the script. (Global mute is fine here — the process
// exits when main() returns.)
console.info = () => {};

type ParsedPage = CorpusPage & {
  tree: ParseTree;
  frontmatter: FrontMatter;
  meta: PageMeta;
};

type RunResult = {
  elapsedMs: number;
  total: number;
  byTag: Record<string, number>;
  relationByKind: Record<string, number>;
};

async function runOnce(parsed: ParsedPage[]): Promise<RunResult> {
  const start = performance.now();
  let total = 0;
  const byTag: Record<string, number> = {};
  const relationByKind: Record<string, number> = {};
  for (const p of parsed) {
    const results = await Promise.all(
      allIndexers.map((idx) => idx(p.meta, p.frontmatter, p.tree, p.text)),
    );
    for (const arr of results) {
      for (const o of arr as ObjectValue<any>[]) {
        total++;
        byTag[o.tag] = (byTag[o.tag] ?? 0) + 1;
        if (o.tag === "relation") {
          const k = (o as any).kind ?? "?";
          relationByKind[k] = (relationByKind[k] ?? 0) + 1;
        }
      }
    }
  }
  return {
    elapsedMs: performance.now() - start,
    total,
    byTag,
    relationByKind,
  };
}

async function main() {
  const pages = loadMarkdownFiles(websiteDir);
  console.log(`Loaded ${pages.length} pages from ${websiteDir}`);

  const parsed: ParsedPage[] = pages.map((p) => {
    const tree = parseMarkdown(p.text);
    return {
      ...p,
      tree,
      frontmatter: extractFrontMatter(tree),
      meta: stubPageMeta(p.name),
    };
  });

  const RUNS = 5;
  let sum = 0;
  let last: RunResult | undefined;
  for (let i = 0; i < RUNS; i++) {
    // Re-parse outside the timed region: extractFrontMatter mutates
    // the tree (adds parent pointers) and the indexer pipeline uses
    // addParentPointers, so each run wants a fresh tree. We don't want
    // to measure that parsing in the indexer timing.
    for (const p of parsed) {
      p.tree = parseMarkdown(p.text);
      p.frontmatter = extractFrontMatter(p.tree);
    }
    last = await runOnce(parsed);
    sum += last.elapsedMs;
  }
  const r = last!;

  console.log(`\n=== TIMING ===`);
  console.log(`Mean over ${RUNS} runs: ${(sum / RUNS).toFixed(1)}ms`);

  console.log(`\n=== INDEX SIZE ===`);
  console.log(`Pages indexed:  ${pages.length}`);
  console.log(`Total objects:  ${r.total}`);
  console.log(`Per page mean:  ${(r.total / pages.length).toFixed(1)}`);

  console.log(`\n=== OBJECTS BY TAG ===`);
  for (const [tag, count] of Object.entries(r.byTag).sort(
    (a, b) => b[1] - a[1],
  )) {
    const pct = ((count / r.total) * 100).toFixed(1);
    console.log(`  ${tag.padEnd(20)} ${String(count).padStart(5)}  (${pct}%)`);
  }

  const relTotal = r.byTag["relation"] ?? 0;
  if (relTotal > 0) {
    console.log(`\n=== RELATION RECORDS BY KIND ===`);
    for (const [kind, count] of Object.entries(r.relationByKind).sort(
      (a, b) => b[1] - a[1],
    )) {
      const pct = ((count / relTotal) * 100).toFixed(1);
      console.log(
        `  ${kind.padEnd(14)} ${String(count).padStart(5)}  (${pct}%)`,
      );
    }
  }
}

void main();
