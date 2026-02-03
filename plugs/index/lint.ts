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

import YAML from "js-yaml";
import { extractFrontMatter } from "./frontmatter.ts";
import { allIndexers } from "./indexer.ts";

/**
 * Lint YAML syntax in frontmatter and fenced code blocks
 */
export function lintYAML(
  { tree, name }: LintEvent,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];

  traverseTree(tree, (node) => {
    if (node.type === "FrontMatterCode") {
      const yamlText = renderToText(node);
      const lintResult = lintYamlBlock(
        yamlText,
        node.from!,
        name,
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
      if (
        ["yaml"].includes(codeLang) || codeLang.startsWith("#")
      ) {
        const codeText = findNodeOfType(node, "CodeText");
        if (!codeText) {
          return true;
        }
        const yamlCode = renderToText(codeText);
        const lintResult = lintYamlBlock(
          yamlCode,
          codeText.from!,
        );
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
    const parsed = YAML.load(yamlText);
    if (pageName && parsed.name && parsed.name != pageName) {
      return {
        from: startPos,
        to: startPos + yamlText.length,
        severity: "error",
        message: "'name' attribute has to match page name",
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
export async function lintObjects(
  { tree, pageMeta: meta, text, name }: LintEvent,
): Promise<LintDiagnostic[]> {
  const frontmatter = extractFrontMatter(tree);

  // Index the page
  const allObjects = (await Promise.all(allIndexers.map((indexer) => {
    return indexer(meta, frontmatter, tree, text);
  }))).flat();
  const result = await index.validateObjects(name, allObjects);
  // If validation failed, return the error
  if (result?.object?.range) {
    return [{
      from: result.object.range[0],
      to: result.object.range[1],
      severity: "error",
      message: result.error,
    }];
  }
  return [];
}
