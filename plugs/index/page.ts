import type { IndexTreeEvent } from "$sb/app_event.ts";
import { editor, markdown, space, YAML } from "$sb/syscalls.ts";

import type { LintDiagnostic, PageMeta } from "$sb/types.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { extractAttributes } from "$sb/lib/attribute.ts";
import { indexObjects } from "./api.ts";
import {
  findNodeOfType,
  renderToText,
  traverseTreeAsync,
} from "$sb/lib/tree.ts";

export async function indexPage({ name, tree }: IndexTreeEvent) {
  if (name.startsWith("_")) {
    // Don't index pages starting with _
    return;
  }
  let pageMeta = await space.getPageMeta(name);

  const frontmatter = await extractFrontmatter(tree);
  const toplevelAttributes = await extractAttributes(tree, false);

  // Push them all into the page object
  pageMeta = { ...pageMeta, ...frontmatter, ...toplevelAttributes };

  pageMeta.tags = [...new Set(["page", ...pageMeta.tags || []])];

  if (pageMeta.tags.includes("template")) {
    // If this is a template, we don't want to index it as a page or anything else, just a template
    pageMeta.tags = ["template"];
  }

  // console.log("Page object", pageObj);
  await indexObjects<PageMeta>(name, [pageMeta]);
}

export async function lintFrontmatter(): Promise<LintDiagnostic[]> {
  const text = await editor.getText();
  const tree = await markdown.parseMarkdown(text);
  const diagnostics: LintDiagnostic[] = [];
  await traverseTreeAsync(tree, async (node) => {
    if (node.type === "FrontMatterCode") {
      const lintResult = await lintYaml(
        renderToText(node),
        node.from!,
        node.to!,
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
        codeLang === "template" || codeLang === "yaml" ||
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
          codeText.to!,
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

const errorRegex = /at line (\d+),? column (\d+)/;

async function lintYaml(
  yamlText: string,
  from: number,
  to: number,
): Promise<LintDiagnostic | undefined> {
  try {
    await YAML.parse(yamlText);
  } catch (e) {
    const errorMatch = errorRegex.exec(e.message);
    if (errorMatch) {
      console.log("YAML error", e.message);
      // const line = parseInt(errorMatch[1], 10) - 1;
      // const yamlLines = yamlText.split("\n");
      // let pos = posOffset;
      // for (let i = 0; i < line; i++) {
      //   pos += yamlLines[i].length + 1;
      // }
      // const endPos = pos + yamlLines[line].length;

      return {
        from,
        to,
        severity: "error",
        message: e.message,
      };
    }
  }
}
