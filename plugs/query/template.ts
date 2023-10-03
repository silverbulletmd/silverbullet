import { WidgetContent } from "$sb/app_event.ts";
import { editor, handlebars, markdown, space, YAML } from "$sb/syscalls.ts";
import { renderMarkdownToHtml } from "../markdown/markdown_render.ts";
import { prepareJS, wrapHTML } from "./util.ts";

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
    if (config.page) {
      let page = config.page;
      if (!page) {
        throw new Error("Missing `page`");
      }

      if (page.startsWith("[[")) {
        page = page.slice(2, -2);
      }
      templateText = await space.readPage(page);
    }

    const rendered = config.raw
      ? templateText
      : await handlebars.renderTemplate(
        templateText,
        config.value,
        {
          page: pageMeta,
        },
      );
    const parsedMarkdown = await markdown.parseMarkdown(rendered);
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
