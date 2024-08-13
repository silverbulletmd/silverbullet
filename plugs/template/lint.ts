import type { LintDiagnostic, LintEvent } from "../../plug-api/types.ts";
import {
  findNodeOfType,
  renderToText,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import { extractFrontmatter } from "@silverbulletmd/silverbullet/lib/frontmatter";
import {
  jsonschema,
  template,
  YAML,
} from "@silverbulletmd/silverbullet/syscalls";
import { TemplateObjectSchema } from "./types.ts";

export async function lintTemplateFrontmatter(
  { tree }: LintEvent,
): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];
  const frontmatter = await extractFrontmatter(tree);

  // Just looking this up again for the purposes of error reporting
  const frontmatterNode = findNodeOfType(tree, "FrontMatterCode")!;
  if (!frontmatter.tags?.includes("template")) {
    return [];
  }
  // TODO: Replace with JSON schema validation
  const validationResults = await jsonschema.validateObject(
    TemplateObjectSchema,
    frontmatter,
  );
  if (validationResults) {
    diagnostics.push({
      from: frontmatterNode.from!,
      to: frontmatterNode.to!,
      message: validationResults,
      severity: "error",
    });
  }
  return diagnostics;
}

export async function lintTemplateBlocks(
  { tree }: LintEvent,
): Promise<LintDiagnostic[]> {
  const frontmatter = await extractFrontmatter(tree);
  const diagnostics: LintDiagnostic[] = [];

  if (frontmatter.tags?.includes("template")) {
    // Parse the whole page as a template to check for errors if this is a template
    try {
      await template.parseTemplate(renderToText(tree));
    } catch (e: any) {
      diagnostics.push({
        from: tree.from!,
        to: tree.to!,
        message: e.message,
        severity: "error",
      });
    }
  }

  await traverseTreeAsync(tree, async (node) => {
    if (node.type === "FencedCode") {
      const codeInfo = findNodeOfType(node, "CodeInfo")!;
      if (!codeInfo) {
        return true;
      }
      const codeLang = codeInfo.children![0].text!;
      if (codeLang !== "template") {
        return true;
      }

      const codeText = findNodeOfType(node, "CodeText");
      if (!codeText) {
        return true;
      }
      const bodyText = renderToText(codeText);
      // See if it parses as YAML, then issue a warning
      try {
        const parsedYaml = await YAML.parse(bodyText);
        if (
          typeof parsedYaml === "object" &&
          (parsedYaml.template || parsedYaml.page || parsedYaml.raw)
        ) {
          diagnostics.push({
            from: codeText.from!,
            to: codeText.to!,
            message:
              "Legacy template syntax detected, please replace ```template with ```include to fix.",
            severity: "warning",
          });
        }
      } catch {
        // Ignore
      }

      // Ok, now parse it as a template and report any parse errors
      try {
        await template.parseTemplate(bodyText);
      } catch (e: any) {
        diagnostics.push({
          from: codeText.from!,
          to: codeText.to!,
          message: e.message,
          severity: "error",
        });
      }
    }

    return false;
  });

  return diagnostics;
}
