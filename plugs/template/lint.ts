import { LintEvent } from "$sb/app_event.ts";
import { LintDiagnostic } from "$sb/types.ts";
import { findNodeOfType } from "$sb/lib/tree.ts";
import { FrontmatterConfig } from "./types.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";

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
  try {
    // Just parse to make sure it's valid
    FrontmatterConfig.parse(frontmatter);
  } catch (e: any) {
    if (e.message.startsWith("[")) { // We got a zod error
      const zodErrors = JSON.parse(e.message);
      for (const zodError of zodErrors) {
        console.log("Zod validation error", zodError);
        diagnostics.push({
          from: frontmatterNode.from!,
          to: frontmatterNode.to!,
          message: `Attribute ${zodError.path.join(".")}: ${zodError.message}`,
          severity: "error",
        });
      }
    } else {
      diagnostics.push({
        from: frontmatterNode.from!,
        to: frontmatterNode.to!,
        message: e.message,
        severity: "error",
      });
    }
  }
  return diagnostics;
}
