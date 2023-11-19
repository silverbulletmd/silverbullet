import { WidgetContent } from "$sb/app_event.ts";
import { markdown, space, system, YAML } from "$sb/syscalls.ts";
import { loadPageObject, replaceTemplateVars } from "../template/template.ts";
import { PageMeta } from "$sb/types.ts";
import { renderTemplate } from "../template/plug_api.ts";
import { renderToText } from "$sb/lib/tree.ts";
import { rewritePageRefs, rewritePageRefsInString } from "$sb/lib/resolve.ts";

type TemplateConfig = {
  // Pull the template from a page
  page?: string;
  // Or use a string directly
  template?: string;
  // Optional argument to pass
  value?: any;
  // If true, don't render the template, just use it as-is
  raw?: boolean;
};

export async function widget(
  bodyText: string,
  pageName: string,
): Promise<WidgetContent> {
  const pageMeta: PageMeta = await loadPageObject(pageName);

  try {
    const config: TemplateConfig = await YAML.parse(bodyText);
    let templateText = config.template || "";
    let templatePage = config.page;
    if (templatePage) {
      // Rewrite federation page references
      templatePage = rewritePageRefsInString(templatePage, pageName);
      if (templatePage.startsWith("[[")) {
        templatePage = templatePage.slice(2, -2);
      }
      if (!templatePage) {
        throw new Error("No template page specified");
      }
      templateText = await space.readPage(templatePage);
    }

    const value = config.value
      ? JSON.parse(
        await replaceTemplateVars(JSON.stringify(config.value), pageMeta),
      )
      : undefined;

    let { text: rendered } = config.raw
      ? { text: templateText }
      : await renderTemplate(
        templateText,
        pageMeta,
        value,
      );

    if (templatePage) {
      const parsedMarkdown = await markdown.parseMarkdown(rendered);
      rewritePageRefs(parsedMarkdown, templatePage);
      rendered = renderToText(parsedMarkdown);
    }

    return system.invokeFunction(
      "markdown.markdownContentWidget",
      rendered,
      pageName,
    );
  } catch (e: any) {
    return system.invokeFunction(
      "markdown.markdownContentWidget",
      `**Error:** ${e.message}`,
      pageName,
    );
  }
}
