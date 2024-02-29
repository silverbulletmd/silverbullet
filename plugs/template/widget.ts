import { markdown, space, YAML } from "$sb/syscalls.ts";
import { loadPageObject, replaceTemplateVars } from "./page.ts";
import { CodeWidgetContent, PageMeta } from "../../plug-api/types.ts";
import { renderTemplate } from "./plug_api.ts";
import { renderToText } from "$sb/lib/tree.ts";
import { rewritePageRefs, rewritePageRefsInString } from "$sb/lib/resolve.ts";
import { queryParsed } from "../query/api.ts";
import { parseQuery } from "$sb/lib/parse-query.ts";

type TemplateWidgetConfig = {
  // Pull the template from a page
  page?: string;
  // Include a page raw (without template processing)
  raw?: string;
  // Or use a string directly
  template?: string;
  // To feed data into the template you can either use a concrete value
  value?: any;

  // Or a query
  query?: string;
};

export async function includeWidget(
  bodyText: string,
  pageName: string,
): Promise<CodeWidgetContent> {
  const pageMeta: PageMeta = await loadPageObject(pageName);

  try {
    const config: TemplateWidgetConfig = await YAML.parse(bodyText);
    let templateText = config.template || "";
    let templatePage = config.page ||
      (typeof config.raw !== "boolean" && config.raw);
    if (templatePage) {
      // Rewrite federation page references
      templatePage = rewritePageRefsInString(templatePage, pageName);
      if (templatePage.startsWith("[[")) {
        templatePage = templatePage.slice(2, -2);
      }
      if (!templatePage) {
        throw new Error("No page specified");
      }
      try {
        templateText = await space.readPage(templatePage);
      } catch (e: any) {
        if (e.message === "Not found") {
          throw new Error(`Page "${templatePage}" not found`);
        }
      }
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
      value = await queryParsed(parsedQuery);
    }

    let { text: rendered } = config.raw
      ? { text: templateText }
      : await renderTemplate(
        templateText,
        value,
        { page: pageMeta },
      );

    if (templatePage) {
      const parsedMarkdown = await markdown.parseMarkdown(rendered);
      rewritePageRefs(parsedMarkdown, templatePage);
      rendered = renderToText(parsedMarkdown);
    }

    return {
      markdown: rendered,
      buttons: [
        {
          description: "Bake result",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-align-left"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>`,
          invokeFunction: "query.bakeButton",
        },
        {
          description: "Edit",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
          invokeFunction: "query.editButton",
        },
        {
          description: "Reload",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
          invokeFunction: "query.refreshAllWidgets",
        },
      ],
    };
  } catch (e: any) {
    return {
      markdown: `**Error:** ${e.message}`,
    };
  }
}

export async function templateWidget(
  bodyText: string,
  pageName: string,
): Promise<CodeWidgetContent> {
  // Check if this is a legacy syntax template widget (with YAML body)
  try {
    const parsedYaml = await YAML.parse(bodyText);
    if (
      typeof parsedYaml === "object" &&
      (parsedYaml.template || parsedYaml.page || parsedYaml.raw)
    ) {
      // Yeah... this looks like a legacy widget
      console.warn(
        "Found a template widget with legacy syntax, implicitly rewriting it to 'include'",
      );
      return includeWidget(bodyText, pageName);
    }
  } catch {
    // Not a legacy widget, good!
  }

  const pageMeta: PageMeta = await loadPageObject(pageName);

  try {
    const { text: rendered } = await renderTemplate(
      bodyText,
      pageMeta,
      { page: pageMeta },
    );

    return {
      markdown: rendered,
      buttons: [
        {
          description: "Bake result",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-align-left"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>`,
          invokeFunction: "query.bakeButton",
        },
        {
          description: "Edit",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
          invokeFunction: "query.editButton",
        },
        {
          description: "Reload",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
          invokeFunction: "query.refreshAllWidgets",
        },
      ],
    };
  } catch (e: any) {
    return {
      markdown: `**Error:** ${e.message}`,
    };
  }
}
