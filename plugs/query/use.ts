import { WidgetContent } from "$sb/app_event.ts";
import { editor, handlebars, markdown, space, YAML } from "$sb/syscalls.ts";
import { renderMarkdownToHtml } from "../markdown/markdown_render.ts";
import { prepareJS, wrapHTML } from "./util.ts";

type UseConfig = {
  template: string;
} & Record<string, any>;

export async function widget(bodyText: string): Promise<WidgetContent> {
  const pageMeta = await space.getPageMeta(await editor.getCurrentPage());

  try {
    const bodyYaml: UseConfig = await YAML.parse(bodyText);
    let template = bodyYaml.template;
    if (!template) {
      throw new Error("Missing `template`");
    }

    if (template.startsWith("[[")) {
      template = template.slice(2, -2);
    }

    const templateText = await space.readPage(template);
    const rendered = await handlebars.renderTemplate(templateText, bodyYaml, {
      page: pageMeta,
    });
    const parsedMarkdown = await markdown.parseMarkdown(rendered);
    const html = renderMarkdownToHtml(parsedMarkdown, {});

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
