import { YAML } from "$sb/syscalls.ts";
import { LintDiagnostic, QueryExpression } from "../../plug-api/types.ts";
import {
  findNodeOfType,
  renderToText,
  traverseTreeAsync,
} from "$sb/lib/tree.ts";
import { LintEvent } from "../../plug-api/types.ts";
import { queryObjects } from "./api.ts";
import { AttributeObject } from "./attributes.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";

export async function lintYAML({ tree }: LintEvent): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];
  const frontmatter = await extractFrontmatter(tree);
  const tags = ["page", ...frontmatter.tags || []];
  await traverseTreeAsync(tree, async (node) => {
    if (node.type === "FrontMatterCode") {
      // Query all readOnly attributes for pages with this tag set
      const readOnlyAttributes = await queryObjects<AttributeObject>(
        "attribute",
        {
          filter: ["and", ["=", ["attr", "tagName"], [
            "array",
            tags.map((tag): QueryExpression => ["string", tag]),
          ]], [
            "=",
            ["attr", "readOnly"],
            ["boolean", true],
          ]],
          distinct: true,
          select: [{ name: "name" }],
        },
      );
      const lintResult = await lintYaml(
        renderToText(node),
        node.from!,
        readOnlyAttributes.map((a) => a.name),
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
        ["include", "embed", "yaml"].includes(codeLang) ||
        codeLang.startsWith("#")
      ) {
        const codeText = findNodeOfType(node, "CodeText");
        if (!codeText) {
          return true;
        }
        const yamlCode = renderToText(codeText);
        const lintResult = await lintYaml(
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

async function lintYaml(
  yamlText: string,
  from: number,
  readOnlyKeys: string[] = [],
): Promise<LintDiagnostic | undefined> {
  try {
    const parsed = await YAML.parse(yamlText);
    for (const key of readOnlyKeys) {
      if (parsed[key]) {
        return {
          from,
          to: from + yamlText.length,
          severity: "error",
          message: `Cannot set read-only attribute "${key}"`,
        };
      }
    }
  } catch (e) {
    const errorMatch = errorRegex.exec(e.message);
    if (errorMatch) {
      console.log("YAML error", e.message);
      const line = parseInt(errorMatch[1], 10) - 1;
      const yamlLines = yamlText.split("\n");
      let pos = from;
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
