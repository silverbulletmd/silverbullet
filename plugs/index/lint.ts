import { lua, YAML } from "@silverbulletmd/silverbullet/syscalls";
import {
  findNodeOfType,
  renderToText,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import type {
  LintDiagnostic,
  LintEvent,
} from "@silverbulletmd/silverbullet/type/client";

export async function lintYAML({ tree }: LintEvent): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];
  await traverseTreeAsync(tree, async (node) => {
    if (node.type === "FrontMatterCode") {
      const lintResult = await lintYaml(
        renderToText(node),
        node.from!,
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
  startPos: number,
): Promise<LintDiagnostic | undefined> {
  try {
    await YAML.parse(yamlText);
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
