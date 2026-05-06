import { index, lua } from "@silverbulletmd/silverbullet/syscalls";
import {
  findNodeOfType,
  renderToText,
  traverseTree,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import type {
  LintDiagnostic,
  LintEvent,
} from "@silverbulletmd/silverbullet/type/client";
import {
  getNameFromPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";
import { isValidAnchorName } from "./anchor.ts";
import { resolveAnchor, type ResolveAnchorResult } from "./api.ts";

import YAML from "js-yaml";
import { extractFrontMatter } from "./frontmatter.ts";
import { allIndexers } from "./indexer.ts";

/**
 * Lint YAML syntax in frontmatter and fenced code blocks
 */
export function lintYAML({ tree, name }: LintEvent): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  // The `name` frontmatter attribute is only required to match the page path
  // for library pages, where it acts as the import name. Read tags straight
  // from the tree so edits in progress take effect immediately, rather than
  // waiting for the indexer to refresh pageMeta.
  const frontmatter = extractFrontMatter(tree);
  const isLibraryPage = frontmatter.tags?.includes("meta/library") ?? false;

  traverseTree(tree, (node) => {
    if (node.type === "FrontMatterCode") {
      const yamlText = renderToText(node);
      const lintResult = lintYamlBlock(
        yamlText,
        node.from!,
        isLibraryPage ? name : undefined,
      );
      if (lintResult) {
        diagnostics.push(lintResult);
      }
      return true;
    }
    if (node.type === "FencedCode") {
      const codeInfo = findNodeOfType(node, "CodeInfo")!;
      if (!codeInfo) {
        return true;
      }
      const codeLang = codeInfo.children![0].text!;
      // All known YAML formats
      if (["yaml"].includes(codeLang) || codeLang.startsWith("#")) {
        const codeText = findNodeOfType(node, "CodeText");
        if (!codeText) {
          return true;
        }
        const yamlCode = renderToText(codeText);
        const lintResult = lintYamlBlock(yamlCode, codeText.from!);
        if (lintResult) {
          diagnostics.push(lintResult);
        }
        return true;
      }
    }
    return false;
  });
  return diagnostics;
}

const errorRegex = /\((\d+):(\d+)\)/;

/**
 * Lint a YAML block
 * @param yamlText - The YAML text to lint
 * @param startPos - The start position of the YAML block
 * @param pageName - The page name to check against
 * @returns A LintDiagnostic if there is an error, undefined otherwise
 */
function lintYamlBlock(
  yamlText: string,
  startPos: number,
  pageName?: string,
): LintDiagnostic | undefined {
  try {
    const parsed = YAML.load(yamlText) as any;
    if (pageName && parsed.name && parsed.name !== pageName) {
      return {
        from: startPos,
        to: startPos + yamlText.length,
        severity: "error",
        message:
          "For library pages, the 'name' attribute must match the page path",
      };
    }
  } catch (e: any) {
    const errorMatch = errorRegex.exec(e.message);
    if (errorMatch) {
      console.log("YAML error", e.message);
      const line = parseInt(errorMatch[1], 10) - 1;
      const yamlLines = yamlText.split("\n");
      let pos = startPos;
      for (let i = 0; i < line; i++) {
        pos += yamlLines[i].length + 1;
      }
      const endPos = pos + yamlLines[line]?.length || pos;

      return {
        from: pos,
        to: endPos,
        severity: "error",
        message: e.message,
      };
    }
  }
}

/**
 * Lint Lua code in fenced code blocks
 * @returns A list of LintDiagnostics for any errors found
 */
export async function lintLua({ tree }: LintEvent): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];
  await traverseTreeAsync(tree, async (node) => {
    if (node.type === "FencedCode") {
      const codeInfo = findNodeOfType(node, "CodeInfo")!;
      if (!codeInfo) {
        return true;
      }
      const codeLang = codeInfo.children![0].text!;
      if (codeLang !== "space-lua") {
        return true;
      }
      const codeText = findNodeOfType(node, "CodeText");
      if (!codeText) {
        return true;
      }
      const luaCode = renderToText(codeText);
      try {
        await lua.parse(luaCode);
      } catch (e: any) {
        const offset = codeText.from!;
        let from = codeText.from!;
        let to = codeText.to!;
        let message = e.message;
        if (message.includes("Parse error")) {
          const pos = +message.slice("Parse error at pos ".length);
          from = offset + pos;
          to = offset + pos;
          message = "Parse error";
        }
        diagnostics.push({
          from,
          to,
          severity: "error",
          message,
        });
        console.log("Lua error", e);
      }
      return true;
    }

    return false;
  });
  return diagnostics;
}

/**
 * Lint objects in the page
 */
export async function lintObjects({
  tree,
  pageMeta: meta,
  text,
  name,
}: LintEvent): Promise<LintDiagnostic[]> {
  if (!meta) {
    return [];
  }
  const frontmatter = extractFrontMatter(tree);

  // Index the page
  const allObjects = (
    await Promise.all(
      allIndexers.map((indexer) => {
        return indexer(meta, frontmatter, tree, text);
      }),
    )
  ).flat();
  const result = await index.validateObjects(name, allObjects);
  // If validation failed, return the error
  if (result?.object?.range) {
    return [
      {
        from: result.object.range[0],
        to: result.object.range[1],
        severity: "error",
        message: result.error,
      },
    ];
  }
  return [];
}

/**
 * Lint anchor-related issues on the current page.
 *
 * Six rules:
 * – Invalid anchor name
 * – Multiple NamedAnchor nodes inside a single host block
 * – Anchor defined on this page also exists on another page (cross-page duplicate)
 * – Same anchor name defined twice on this page in different blocks
 * – WikiLink whose ref targets a missing anchor
 * – WikiLink whose ref targets an ambiguous (duplicate) anchor
 */
export async function lintAnchors({
  tree,
  name: pageName,
}: LintEvent): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];

  // Map from anchor name to list of node positions
  const anchorNodesByName = new Map<
    string,
    Array<{ from: number; to: number }>
  >();
  // All NamedAnchor nodes in document order
  const allAnchorNodes: Array<{ name: string; from: number; to: number }> = [];

  traverseTree(tree, (node) => {
    if (node.type === "NamedAnchor") {
      const literal = renderToText(node);
      const anchorName = literal.slice(1); // strip leading $
      const entry = { from: node.from!, to: node.to! };
      allAnchorNodes.push({ name: anchorName, ...entry });
      if (!anchorNodesByName.has(anchorName)) {
        anchorNodesByName.set(anchorName, []);
      }
      anchorNodesByName.get(anchorName)!.push(entry);
      return true; // NamedAnchor has no interesting children
    }
    return false;
  });

  // Page-level anchor from frontmatter $ref. Track it so duplicate
  // checks (rules C and C2) include this page's anchor name.
  const frontmatter = extractFrontMatter(tree);
  const fmAnchor = (frontmatter as any).$ref;
  if (typeof fmAnchor === "string" && isValidAnchorName(fmAnchor)) {
    const fmNode = findNodeOfType(tree, "FrontMatter");
    const fmRange = fmNode
      ? { from: fmNode.from!, to: fmNode.to! }
      : { from: 0, to: 0 };
    if (!anchorNodesByName.has(fmAnchor)) {
      anchorNodesByName.set(fmAnchor, []);
    }
    anchorNodesByName.get(fmAnchor)!.push(fmRange);
  }

  // Invalid anchor name
  for (const node of allAnchorNodes) {
    if (!isValidAnchorName(node.name)) {
      diagnostics.push({
        from: node.from,
        to: node.to,
        severity: "error",
        message: `Invalid anchor name: "$${node.name}"`,
      });
    }
  }

  // Multiple anchors per host block
  const hostTypes = new Set([
    "Paragraph",
    "ListItem",
    "Task",
    "ATXHeading1",
    "ATXHeading2",
    "ATXHeading3",
    "ATXHeading4",
    "ATXHeading5",
    "ATXHeading6",
  ]);

  traverseTree(tree, (node) => {
    if (!hostTypes.has(node.type!)) {
      return false;
    }

    // Collect NamedAnchor descendants without crossing into nested ListItems
    const anchorsInHost: Array<{ from: number; to: number; name: string }> = [];

    traverseTree(node, (child) => {
      // Don't descend into nested list items (avoid double-counting)
      if (child !== node && child.type === "ListItem") {
        return true; // stop recursion into nested list items
      }
      if (child.type === "NamedAnchor") {
        const literal = renderToText(child);
        anchorsInHost.push({
          from: child.from!,
          to: child.to!,
          name: literal.slice(1),
        });
        return true;
      }
      return false;
    });

    // Flag every anchor after the first
    for (let i = 1; i < anchorsInHost.length; i++) {
      const extra = anchorsInHost[i];
      diagnostics.push({
        from: extra.from,
        to: extra.to,
        severity: "error",
        message:
          `Multiple anchors in the same block: "$${extra.name}" is the ${i + 1}st anchor here. A block may only carry one anchor.`,
      });
    }

    return true;
  });

  // Batch resolve all anchor names referenced on page

  // Unique names defined on this page
  const definedAnchorNames = new Set(anchorNodesByName.keys());

  // Unique anchor link targets from WikiLinks
  type AnchorLinkRef = {
    name: string;
    page?: string;
    from: number;
    to: number;
  };
  const anchorLinks: AnchorLinkRef[] = [];

  traverseTree(tree, (node) => {
    if (node.type === "WikiLink") {
      const wikiLinkPage = findNodeOfType(node, "WikiLinkPage");
      if (!wikiLinkPage) return true;
      const url = wikiLinkPage.children![0].text!;
      const ref = parseToRef(url);
      if (ref?.details?.type === "anchor") {
        const linkedPage = ref.path
          ? getNameFromPath(ref.path)
          : undefined;
        anchorLinks.push({
          name: ref.details.name,
          page: linkedPage || undefined,
          from: node.from!,
          to: node.to!,
        });
      }
      return true;
    }
    return false;
  });

  // Build a set of unique lookup keys to resolve in parallel
  // Key format: "name" for bare anchors, "page\0name" for page-qualified
  type LookupKey = string;
  const toResolve = new Map<LookupKey, { name: string; page?: string }>();

  for (const name of definedAnchorNames) {
    // Bare lookup — finds duplicates across all pages
    const key: LookupKey = name;
    if (!toResolve.has(key)) {
      toResolve.set(key, { name });
    }
  }

  for (const link of anchorLinks) {
    const key: LookupKey = link.page ? `${link.page}\0${link.name}` : link.name;
    if (!toResolve.has(key)) {
      toResolve.set(key, { name: link.name, page: link.page });
    }
  }

  // Resolve all in parallel
  const resolved = new Map<LookupKey, ResolveAnchorResult>();
  await Promise.all(
    [...toResolve.entries()].map(async ([key, { name, page }]) => {
      const result = await resolveAnchor(name, page);
      resolved.set(key, result);
    }),
  );

  // Same-page duplicate
  // The index storage key collapses same-page same-name records, so rule C
  // (cross-page) can't catch this. Detect from the tree directly.
  for (const [anchorName, nodes] of anchorNodesByName) {
    if (nodes.length > 1) {
      for (const node of nodes) {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message:
            `Duplicate anchor "$${anchorName}" — defined ${nodes.length} times on this page.`,
        });
      }
    }
  }

  // Duplicate anchor defined on this page
  for (const anchorName of definedAnchorNames) {
    const key: LookupKey = anchorName;
    const result = resolved.get(key);
    if (result && !result.ok && result.reason === "duplicate") {
      const otherPages = result.hits
        .filter((h) => h.page !== pageName)
        .map((h) => h.page);
      // Skip if all duplicates are on the current page — already handled
      // by rule C2 (same-page duplicate detection from the tree).
      if (otherPages.length === 0) continue;
      const nodes = anchorNodesByName.get(anchorName) ?? [];
      for (const node of nodes) {
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message:
            `Duplicate anchor "$${anchorName}" — also defined on: ${otherPages.join(", ")}`,
        });
      }
    }
  }

  // Broken / ambiguous anchor links
  for (const link of anchorLinks) {
    const key: LookupKey = link.page
      ? `${link.page}\0${link.name}`
      : link.name;
    const result = resolved.get(key);
    if (!result || result.ok) {
      continue; // resolved fine — no diagnostic
    }

    if (result.reason === "missing") {
      diagnostics.push({
        from: link.from,
        to: link.to,
        severity: "error",
        message: `Anchor not found: "$${link.name}"${link.page ? ` on page "${link.page}"` : ""}`,
      });
    } else if (result.reason === "duplicate") {
      // Ambiguous (duplicate) anchor link
      const pages = result.hits.map((h) => h.page).join(", ");
      diagnostics.push({
        from: link.from,
        to: link.to,
        severity: "error",
        message:
          `Ambiguous anchor "$${link.name}" — found on multiple pages: ${pages}`,
      });
    }
  }

  return diagnostics;
}
