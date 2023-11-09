import { handlebars, markdown, YAML } from "$sb/syscalls.ts";
import type { PageMeta } from "$sb/types.ts";
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
  pageMeta: PageMeta,
  data: any = {},
): Promise<string> {
  const tree = await markdown.parseMarkdown(templateText);
  const frontmatter: Partial<TemplateObject> = await extractFrontmatter(tree, {
    removeFrontmatterSection: true,
    removeTags: ["template"],
  });
  templateText = renderToText(tree).trimStart();
  // console.log(`Trimmed template: |${templateText}|`);
  // If a 'frontmatter' key was specified in the frontmatter, use that as the frontmatter
  if (frontmatter.frontmatter) {
    if (typeof frontmatter.frontmatter === "string") {
      templateText = "---\n" + frontmatter.frontmatter + "---\n" + templateText;
    } else {
      templateText = "---\n" + (await YAML.stringify(frontmatter.frontmatter)) +
        "---\n" + templateText;
    }
  }
  return handlebars.renderTemplate(templateText, data, { page: pageMeta });
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
