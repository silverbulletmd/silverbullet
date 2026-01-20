import {
  editor,
  index,
  lua,
  markdown,
} from "@silverbulletmd/silverbullet/syscalls";

import type { FrontMatter } from "./frontmatter.ts";
import {
  findNodeOfType,
  type ParseTree,
  renderToText,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import { updateITags } from "./tags.ts";
import type { AspiringPageObject } from "./link.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import type { LintDiagnostic } from "@silverbulletmd/silverbullet/type/client";

import YAML from "js-yaml";

export async function indexPage(
  pageMeta: PageMeta,
  frontmatter: FrontMatter,
  _tree: ParseTree,
) {
  // Push them all into the page object
  // Note the order here, making sure that the actual page meta data overrules
  // any attempt to manually set built-in attributes like 'name' or 'lastModified'
  // pageMeta appears at the beginning and the end due to the ordering behavior of ojects in JS (making builtin attributes appear first)
  const combinedPageMeta: PageMeta = {
    ...pageMeta,
    ...frontmatter,
    ...pageMeta,
  };

  combinedPageMeta.tags = [...new Set([...frontmatter.tags || []])];

  combinedPageMeta.tag = "page";

  if (combinedPageMeta.aliases && !Array.isArray(combinedPageMeta.aliases)) {
    console.warn(
      "Aliases must be an array",
      combinedPageMeta.aliases,
      "falling back to empty array",
    );
    combinedPageMeta.aliases = [];
  }

  updateITags(combinedPageMeta, frontmatter);

  // Make sure this page is no (longer) in the aspiring pages list
  // TODO: This can possibly done more optimally
  const aspiringPages = await index.queryLuaObjects<AspiringPageObject>(
    "aspiring-page",
    {
      objectVariable: "_",
      where: await lua.parseExpression(`_.name == pageRef`),
    },
    { pageRef: pageMeta.name },
  );
  for (const aspiringPage of aspiringPages) {
    console.log("Deleting aspiring page", aspiringPage);
    await index.deleteObject(
      "aspiring-page",
      aspiringPage.page,
      aspiringPage.ref,
    );
  }

  return [combinedPageMeta];
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
    await YAML.load(yamlText);
  } catch (e: any) {
    const errorMatch = errorRegex.exec(e.message);
    if (errorMatch) {
      console.log("YAML error", e.message);

      return {
        from,
        to,
        severity: "error",
        message: e.message,
      };
    }
  }
}

export async function loadPageObject(pageName?: string): Promise<PageMeta> {
  if (!pageName) {
    return {
      ref: "",
      name: "",
      tags: ["page"],
      lastModified: "",
      created: "",
    } as PageMeta;
  }
  return (await index.getObjectByRef<PageMeta>(
    pageName,
    "page",
    pageName,
  )) || {
    ref: pageName,
    name: pageName,
    tags: ["page"],
    lastModified: "",
    created: "",
  } as PageMeta;
}
