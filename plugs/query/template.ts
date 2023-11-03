import { WidgetContent } from "$sb/app_event.ts";
import { handlebars, markdown, space, system, YAML } from "$sb/syscalls.ts";
import { rewritePageRefs } from "$sb/lib/resolve.ts";
import { replaceTemplateVars } from "../template/template.ts";
import { renderToText } from "$sb/lib/tree.ts";

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
  const pageMeta = await space.getPageMeta(pageName);

  try {
    const config: TemplateConfig = await YAML.parse(bodyText);
    let templateText = config.template || "";
    let templatePage = config.page;
    if (templatePage) {
      if (templatePage.startsWith("[[")) {
        templatePage = templatePage.slice(2, -2);
      }
      templateText = await space.readPage(templatePage);
    }

    const value = config.value
      ? JSON.parse(
        await replaceTemplateVars(JSON.stringify(config.value), pageMeta),
      )
      : undefined;

    let rendered = config.raw ? templateText : await handlebars.renderTemplate(
      templateText,
      value,
      {
        page: pageMeta,
      },
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
