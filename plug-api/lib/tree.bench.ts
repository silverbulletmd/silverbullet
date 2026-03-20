import { bench, describe } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addParentPointers,
  cloneTree,
  collectNodesMatching,
  collectNodesOfType,
  findNodeOfType,
  type ParseTree,
  removeParentPointers,
  renderToText,
  replaceNodesMatching,
  traverseTree,
} from "./tree.ts";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import {
  lezerToParseTree,
  parse,
} from "../../client/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../../client/markdown_parser/parser.ts";

// --- Load all website markdown files ---
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const websiteDir = join(__dirname, "../../website");

type PageData = {
  name: string;
  text: string;
};

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

// Pre-parse trees for tree-operation benchmarks
const parsedTrees: ParseTree[] = pages.map((p) => parseMarkdown(p.text));

describe("Tree API Benchmarks", () => {
  bench("lezerToParseTree (all pages)", () => {
    for (const p of pages) {
      // Remove \r like parse() does, then run lezer + conversion
      const text = p.text.replaceAll("\r", "");
      const lezerTree = extendedMarkdownLanguage.parser.parse(text);
      lezerToParseTree(text, lezerTree.topNode);
    }
  });

  bench("addParentPointers (all pages)", () => {
    for (const tree of parsedTrees) {
      addParentPointers(tree);
    }
  });

  bench("removeParentPointers (all pages)", () => {
    // First add them so we can remove them
    for (const tree of parsedTrees) {
      addParentPointers(tree);
    }
    for (const tree of parsedTrees) {
      removeParentPointers(tree);
    }
  });

  bench("collectNodesOfType (all pages, 'WikiLink')", () => {
    for (const tree of parsedTrees) {
      collectNodesOfType(tree, "WikiLink");
    }
  });

  bench("collectNodesMatching (all pages, ATXHeading*)", () => {
    for (const tree of parsedTrees) {
      collectNodesMatching(tree, (n) => !!n.type?.startsWith("ATXHeading"));
    }
  });

  bench("findNodeOfType (all pages, 'FrontMatter')", () => {
    for (const tree of parsedTrees) {
      findNodeOfType(tree, "FrontMatter");
    }
  });

  bench("traverseTree (all pages, full walk)", () => {
    for (const tree of parsedTrees) {
      traverseTree(tree, (_n) => false);
    }
  });

  bench("replaceNodesMatching (all pages, no-op)", () => {
    for (const tree of parsedTrees) {
      replaceNodesMatching(tree, (_n) => undefined);
    }
  });

  bench("renderToText (all pages)", () => {
    for (const tree of parsedTrees) {
      renderToText(tree);
    }
  });

  bench("cloneTree (all pages)", () => {
    for (const tree of parsedTrees) {
      cloneTree(tree);
    }
  });
});
