import { markdown, template, YAML } from "$sb/syscalls.ts";
import { extractFrontmatter } from "$sb/lib/frontmatter.ts";
import { TemplateObject } from "./types.ts";
import { renderToText } from "$sb/lib/tree.ts";

/**
 * Strips the template from its frontmatter and renders it.
 * The assumption is that the frontmatter has already been parsed and should not appear in thhe rendered output.
 * @param templateText the template text
 * @param data data to be rendered by the template
 * @param globals a set of global variables
 * @returns
 */
export async function renderTemplate(
  templateText: string,
  data: any = {},
  variables: Record<string, any> = {},
): Promise<{ renderedFrontmatter?: string; frontmatter: any; text: string }> {
  try {
    const tree = await markdown.parseMarkdown(templateText);
    const frontmatter: Partial<TemplateObject> = await extractFrontmatter(
      tree,
      {
        removeFrontmatterSection: true,
        removeTags: ["template"],
      },
    );
    templateText = renderToText(tree).trimStart();
    // If a 'frontmatter' key was specified in the frontmatter, use that as the frontmatter
    let frontmatterText: string | undefined;
    if (frontmatter.frontmatter) {
      if (typeof frontmatter.frontmatter === "string") {
        frontmatterText = frontmatter.frontmatter;
      } else {
        frontmatterText = await YAML.stringify(frontmatter.frontmatter);
      }
      frontmatterText = await template.renderTemplate(
        frontmatterText,
        data,
        variables,
      );
    }
    return {
      frontmatter,
      renderedFrontmatter: frontmatterText,
      text: await template.renderTemplate(templateText, data, variables),
    };
  } catch (e) {
    console.error("Error rendering template", e);
    throw e;
  }
}

/**
 * Strips a template text from its frontmatter and #template tag
 */
export async function cleanTemplate(
  templateText: string,
): Promise<string> {
  const tree = await markdown.parseMarkdown(templateText);
  await extractFrontmatter(tree, {
    removeFrontmatterSection: true,
    removeTags: ["template"],
  });
  return renderToText(tree).trimStart();
}
