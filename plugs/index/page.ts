import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/types";
import {
  editor,
  jsonschema,
  markdown,
  space,
  system,
  YAML,
} from "@silverbulletmd/silverbullet/syscalls";

import type { LintDiagnostic, PageMeta } from "../../plug-api/types.ts";
import { extractFrontmatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import { extractAttributes } from "@silverbulletmd/silverbullet/lib/attribute";
import { indexObjects, queryDeleteObjects } from "./api.ts";
import {
  findNodeOfType,
  renderToText,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import { updateITags } from "@silverbulletmd/silverbullet/lib/tags";
import type { AspiringPageObject } from "./page_links.ts";
import { deepObjectMerge } from "@silverbulletmd/silverbullet/lib/json";

export async function indexPage({ name, tree }: IndexTreeEvent) {
  if (name.startsWith("_")) {
    // Don't index pages starting with _
    return;
  }
  const pageMeta = await space.getPageMeta(name);
  const frontmatter = await extractFrontmatter(tree);
  const toplevelAttributes = await extractAttributes(
    ["page", ...frontmatter.tags || []],
    tree,
  );

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
  await queryDeleteObjects<AspiringPageObject>("aspiring-page", {
    filter: ["=", ["attr", "name"], ["string", name]],
  });

  const tagSchema = (await system.getSpaceConfig("schema")).tag;
  // Validate the page meta against schemas, and only index the tags that validate
  for (const tag of combinedPageMeta.tags) {
    let schema = tagSchema[tag];
    if (schema) {
      schema = deepObjectMerge({ type: "object" }, schema);
      const validationError = await jsonschema.validateObject(
        schema,
        combinedPageMeta,
      );
      if (validationError) {
        console.warn(
          "Validation failed for",
          combinedPageMeta,
          "for tag",
          tag,
          ". Error:",
          validationError,
          ". Removing tag until this is resolved.",
        );
        combinedPageMeta.tags.splice(combinedPageMeta.tags.indexOf(tag), 1);
      }
    }
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
  } catch (e) {
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
