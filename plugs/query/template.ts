import { WidgetContent } from "$sb/app_event.ts";
import { editor, handlebars, markdown, space, YAML } from "$sb/syscalls.ts";
import { rewritePageRefs } from "$sb/lib/resolve.ts";
import { renderMarkdownToHtml } from "../markdown/markdown_render.ts";
import { prepareJS, wrapHTML } from "./util.ts";
import { replaceTemplateVars } from "../template/template.ts";

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

export async function widget(bodyText: string): Promise<WidgetContent> {
  const pageMeta = await space.getPageMeta(await editor.getCurrentPage());

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

    const rendered = config.raw
      ? templateText
      : await handlebars.renderTemplate(
        templateText,
        value,
        {
          page: pageMeta,
        },
      );
    const parsedMarkdown = await markdown.parseMarkdown(rendered);

    if (templatePage) {
      rewritePageRefs(parsedMarkdown, templatePage);
    }
    const html = renderMarkdownToHtml(parsedMarkdown, {
      smartHardBreak: true,
    });

    return {
      html: await wrapHTML(html),
      script: await prepareJS(),
    };
  } catch (e: any) {
    return {
      html: `<b>Error:</b> ${e.message}`,
    };
  }
}
