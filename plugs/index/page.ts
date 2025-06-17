import type { IndexTreeEvent } from "../../type/event.ts";
import {
  editor,
  lua,
  markdown,
  space,
  YAML,
} from "@silverbulletmd/silverbullet/syscalls";

import { extractFrontMatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import { extractAttributes } from "@silverbulletmd/silverbullet/lib/attribute";
import {
  deleteObject,
  getObjectByRef,
  indexObjects,
  queryLuaObjects,
} from "./api.ts";
import {
  findNodeOfType,
  renderToText,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import { updateITags } from "@silverbulletmd/silverbullet/lib/tags";
import type { AspiringPageObject } from "./page_links.ts";
import type { PageMeta } from "../../type/index.ts";
import type { LintDiagnostic } from "@silverbulletmd/silverbullet/type/client";

export async function indexPage({ name, tree }: IndexTreeEvent) {
  if (name.startsWith("_")) {
    // Don't index pages starting with _
    return;
  }
  const pageMeta = await space.getPageMeta(name);
  const frontmatter = await extractFrontMatter(tree);
  const toplevelAttributes = await extractAttributes(tree);

  // Push them all into the page object
  // Note the order here, making sure that the actual page meta data overrules
  // any attempt to manually set built-in attributes like 'name' or 'lastModified'
  // pageMeta appears at the beginning and the end due to the ordering behavior of ojects in JS (making builtin attributes appear first)
  const combinedPageMeta: PageMeta = {
    ...pageMeta,
    ...frontmatter,
    ...toplevelAttributes,
    ...pageMeta,
  };

  combinedPageMeta.tags = [
    ...new Set([
      ...frontmatter.tags || [],
      ...toplevelAttributes.tags || [],
    ]),
  ];

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
  const aspiringPages = await queryLuaObjects<AspiringPageObject>(
    "aspiring-page",
    {
      objectVariable: "_",
      where: await lua.parseExpression(`_.name == pageRef`),
    },
    { pageRef: name },
  );
  for (const aspiringPage of aspiringPages) {
    console.log("Deleting aspiring page", aspiringPage);
    await deleteObject("aspiring-page", aspiringPage.page, aspiringPage.ref);
  }

  // console.log("Page object", combinedPageMeta);
  await indexObjects<PageMeta>(name, [combinedPageMeta]);
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
  return (await getObjectByRef<PageMeta>(
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
