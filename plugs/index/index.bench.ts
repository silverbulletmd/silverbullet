import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { bench, describe } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { indexData } from "./data.ts";
import { extractFrontMatter, type FrontMatter } from "./frontmatter.ts";
import { indexHeaders } from "./header.ts";
import { allIndexers } from "./indexer.ts";
import { indexItems } from "./item.ts";
import { indexPage as pageIndexPage } from "./page.ts";
import { indexParagraphs } from "./paragraph.ts";
import { indexRelations } from "./relation.ts";
import { indexSpaceLua } from "./space_lua.ts";
import { indexSpaceStyle } from "./space_style.ts";
import { indexTables } from "./table.ts";
import { indexTags } from "./tags.ts";
import {
  type CorpusPage,
  docsDir,
  loadMarkdownFiles,
  stubPageMeta,
} from "./test_corpus.ts";

const pages = loadMarkdownFiles(docsDir);

// Pre-parse trees for indexer-only benchmarks.
type ParsedPage = CorpusPage & {
  tree: ParseTree;
  frontmatter: FrontMatter;
  pageMeta: PageMeta;
};

createMockSystem();

const parsedPages: ParsedPage[] = pages.map((p) => {
  const tree = parseMarkdown(p.text);
  return {
    ...p,
    tree,
    frontmatter: extractFrontMatter(tree),
    pageMeta: stubPageMeta(p.name),
  };
});

// --- Benchmarks ---

describe("Page Indexing Benchmarks", () => {
  bench("parseMarkdown (all pages)", () => {
    for (const p of pages) {
      parseMarkdown(p.text);
    }
  });

  bench("extractFrontMatter (all pages)", () => {
    // Re-parse since extractFrontMatter mutates the tree (adds parent pointers)
    for (const p of pages) {
      const tree = parseMarkdown(p.text);
      extractFrontMatter(tree);
    }
  });

  bench("indexRelations (all pages)", async () => {
    for (const p of parsedPages) {
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await indexRelations(p.pageMeta, fm, tree, p.text);
    }
  });

  bench("indexItems (all pages)", async () => {
    for (const p of parsedPages) {
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await indexItems(p.pageMeta, fm, tree);
    }
  });

  bench("indexHeaders (all pages)", async () => {
    for (const p of parsedPages) {
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await indexHeaders(p.pageMeta, fm, tree);
    }
  });

  bench("indexTags (all pages)", async () => {
    for (const p of parsedPages) {
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await indexTags(p.pageMeta, fm, tree);
    }
  });

  bench("indexTables (all pages)", async () => {
    for (const p of parsedPages) {
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await indexTables(p.pageMeta, fm, tree);
    }
  });

  bench("indexParagraphs (all pages)", async () => {
    for (const p of parsedPages) {
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await indexParagraphs(p.pageMeta, fm, tree);
    }
  });

  bench("indexData (all pages)", async () => {
    for (const p of parsedPages) {
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await indexData(p.pageMeta, fm, tree);
    }
  });

  bench("indexSpaceLua (all pages)", async () => {
    for (const p of parsedPages) {
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await indexSpaceLua(p.pageMeta, fm, tree);
    }
  });

  bench("indexSpaceStyle (all pages)", async () => {
    for (const p of parsedPages) {
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await indexSpaceStyle(p.pageMeta, fm, tree);
    }
  });

  bench("pageIndexPage (all pages)", async () => {
    for (const p of parsedPages) {
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await pageIndexPage(p.pageMeta, fm, tree);
    }
  });

  bench("full pipeline (all pages)", async () => {
    for (const p of pages) {
      const tree = parseMarkdown(p.text);
      const frontmatter = extractFrontMatter(tree);
      const meta = stubPageMeta(p.name);
      await Promise.all(
        allIndexers.map((indexer) => indexer(meta, frontmatter, tree, p.text)),
      );
    }
  });
});
