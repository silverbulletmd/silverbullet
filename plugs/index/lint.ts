import { config, jsonschema, lua } from "@silverbulletmd/silverbullet/syscalls";
import {
  findNodeOfType,
  renderToText,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import type {
  LintDiagnostic,
  LintEvent,
} from "@silverbulletmd/silverbullet/type/client";

import YAML from "js-yaml";
import { extractFrontMatter } from "./frontmatter.ts";

export async function lintYAML(
  { tree, name }: LintEvent,
): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];
  const frontmatter = extractFrontMatter(tree);

  await traverseTreeAsync(tree, async (node) => {
    if (node.type === "FrontMatterCode") {
      const yamlText = renderToText(node);
      const lintResult = lintYaml(
        yamlText,
        node.from!,
        name,
      );
      if (lintResult) {
        diagnostics.push(lintResult);
      } else {
        const parsed = YAML.load(yamlText);
        // Parses as valid YAML, now let's see if we need to do schema validation
        for (const tag of frontmatter.tags || []) {
          const schema = await config.get(["tags", tag, "schema"], undefined);

          if (schema) {
            const validationError = await jsonschema.validateObject(
              schema,
              parsed,
            );
            if (validationError) {
              diagnostics.push({
                message: `${tag} validation failed: ${validationError}`,
                severity: "error",
                from: node.from!,
                to: node.to!,
              });
            }
          }
        }
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
        const lintResult = lintYaml(
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

function lintYaml(
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
