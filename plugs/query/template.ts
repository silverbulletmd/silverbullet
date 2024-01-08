import { markdown, space, YAML } from "$sb/syscalls.ts";
import { loadPageObject, replaceTemplateVars } from "../template/template.ts";
import { CodeWidgetContent, PageMeta } from "$sb/types.ts";
import { renderTemplate } from "../template/plug_api.ts";
import { renderToText } from "$sb/lib/tree.ts";
import { rewritePageRefs, rewritePageRefsInString } from "$sb/lib/resolve.ts";
import { performQuery } from "./query.ts";
import { parseQuery } from "$sb/lib/parse-query.ts";

type TemplateConfig = {
  // Pull the template from a page
  page?: string;
  // Or use a string directly
  template?: string;
  // To feed data into the template you can either use a concrete value
  value?: any;

  // Or a query
  query?: string;

  // If true, don't render the template, just use it as-is
  raw?: boolean;
};

export async function widget(
  bodyText: string,
  pageName: string,
): Promise<CodeWidgetContent> {
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

    let value: any;

    if (config.value) {
      value = JSON.parse(
        await replaceTemplateVars(JSON.stringify(config.value), pageMeta),
      );
    }

    if (config.query) {
      const parsedQuery = await parseQuery(
        await replaceTemplateVars(config.query, pageMeta),
      );
      value = await performQuery(parsedQuery, pageMeta);
    }

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

    return {
      markdown: rendered,
      buttons: [{
        description: "Edit",
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
        invokeFunction: "query.editButton",
      }, {
        description: "Reload",
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
        invokeFunction: "query.refreshAllWidgets",
      }],
    };
  } catch (e: any) {
    return {
      markdown: `**Error:** ${e.message}`,
    };
  }
}
