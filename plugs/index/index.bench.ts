import { bench, describe } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexPage as pageIndexPage } from "./page.ts";
import { indexData } from "./data.ts";
import { indexItems } from "./item.ts";
import { indexHeaders } from "./header.ts";
import { indexParagraphs } from "./paragraph.ts";
import { indexLinks } from "./link.ts";
import { indexTables } from "./table.ts";
import { indexSpaceLua } from "./space_lua.ts";
import { indexSpaceStyle } from "./space_style.ts";
import { indexTags } from "./tags.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import type { FrontMatter } from "./frontmatter.ts";
import { allIndexers } from "./indexer.ts";

// --- Load all website markdown files ---
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const websiteDir = join(__dirname, "../../website");

interface PageData {
  name: string;
  text: string;
}

function loadMarkdownFiles(dir: string, base = ""): PageData[] {
  const pages: PageData[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relativePath = base ? `${base}/${entry}` : entry;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      pages.push(...loadMarkdownFiles(fullPath, relativePath));
    } else if (entry.endsWith(".md")) {
      pages.push({
        name: relativePath.replace(/\.md$/, ""),
        text: readFileSync(fullPath, "utf-8"),
      });
    }
  }
  return pages;
}

const pages = loadMarkdownFiles(websiteDir);

// Pre-parse trees for indexer-only benchmarks
interface ParsedPage extends PageData {
  tree: ParseTree;
  frontmatter: FrontMatter;
  pageMeta: PageMeta;
}

function buildParsedPages(): ParsedPage[] {
  return pages.map((p) => {
    const tree = parseMarkdown(p.text);
    const frontmatter = extractFrontMatter(tree);
    const pageMeta: PageMeta = {
      ref: p.name,
      name: p.name,
      tag: "page",
      created: "",
      lastModified: "",
      perm: "rw",
    };
    return { ...p, tree, frontmatter, pageMeta };
  });
}

// Setup mock system (registers syscalls globally)
createMockSystem();
const parsedPages = buildParsedPages();

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

  bench("indexLinks (all pages)", async () => {
    for (const p of parsedPages) {
      // Re-parse to get a fresh tree (extractFrontMatter adds parent pointers)
      const tree = parseMarkdown(p.text);
      const fm = extractFrontMatter(tree);
      await indexLinks(p.pageMeta, fm, tree, p.text);
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
      const pageMeta: PageMeta = {
        ref: p.name,
        name: p.name,
        tag: "page",
        created: "",
        lastModified: "",
        perm: "rw",
      };
      await Promise.all(
        allIndexers.map((indexer) =>
          indexer(pageMeta, frontmatter, tree, p.text)
        ),
      );
    }
  });
});
