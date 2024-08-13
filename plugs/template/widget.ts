import {
  editor,
  markdown,
  space,
  system,
  YAML,
} from "@silverbulletmd/silverbullet/syscalls";
import { loadPageObject, replaceTemplateVars } from "./page.ts";
import type { CodeWidgetContent, PageMeta } from "../../plug-api/types.ts";
import { renderTemplate } from "./plug_api.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import {
  isFederationPath,
  resolvePath,
  rewritePageRefs,
  rewritePageRefsInString,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { queryParsed } from "../query/api.ts";
import { parseQuery } from "../../plug-api/lib/parse_query.ts";
import { parsePageRef } from "@silverbulletmd/silverbullet/lib/page_ref";

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
  const spaceConfig = await system.getSpaceConfig();

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
        await replaceTemplateVars(
          JSON.stringify(config.value),
          pageMeta,
          spaceConfig,
        ),
      );
    }

    if (config.query) {
      const parsedQuery = await parseQuery(
        await replaceTemplateVars(config.query, pageMeta, spaceConfig),
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
          invokeFunction: ["query.bakeButton", bodyText],
        },
        {
          description: "Edit",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
          invokeFunction: ["query.editButton", bodyText],
        },
        {
          description: "Reload",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
          invokeFunction: ["query.refreshAllWidgets"],
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

  const config = await system.getSpaceConfig();
  const pageMeta: PageMeta = await loadPageObject(pageName);

  try {
    const { text: rendered } = await renderTemplate(
      bodyText,
      pageMeta,
      { page: pageMeta, config },
    );

    return {
      markdown: rendered,
      buttons: [
        {
          description: "Bake result",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-align-left"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>`,
          invokeFunction: ["query.bakeButton", bodyText],
        },
        {
          description: "Edit",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
          invokeFunction: ["query.editButton", bodyText],
        },
        {
          description: "Reload",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
          invokeFunction: ["query.refreshAllWidgets"],
        },
      ],
    };
  } catch (e: any) {
    return {
      markdown: `**Error:** ${e.message}`,
    };
  }
}

export async function transclusionWidget(
  bodyText: string,
  pageName: string,
): Promise<CodeWidgetContent> {
  const config = await system.getSpaceConfig();
  const pageMeta: PageMeta = await loadPageObject(pageName);
  let url: string | undefined = undefined;
  let match: RegExpExecArray | null;
  if ((match = /!?\[([^\]]*)\]\((.+)\)/g.exec(bodyText))) {
    [/* fullMatch */, /* alias */ , url] = match;
  } else if (
    (match = /(!?\[\[)([^\]\|]+)(?:\|([^\]]+))?(\]\])/g.exec(bodyText))
  ) {
    [/* fullMatch */, /* firstMark */ , url /* alias */] = match;
    if (!isFederationPath(url)) {
      url = "/" + url;
    }
  }

  try {
    if (!url) {
      throw new Error("Could not parse link");
    }
    url = resolvePath(pageName, url, true);

    const templateText =
      `{{rewriteRefsAndFederationLinks([[${url}]], "${url}")}}`;

    const { text: rendered } = await renderTemplate(
      templateText,
      pageMeta,
      { page: pageMeta, config },
    );

    return {
      markdown: rendered,
      buttons: [
        {
          description: "Bake result",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-align-left"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>`,
          invokeFunction: ["query.bakeButton", bodyText],
        },
        {
          description: "Open Page",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
          invokeFunction: ["template.navigateButton", url],
        },
        {
          description: "Reload",
          svg:
            `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
          invokeFunction: ["query.refreshAllWidgets", bodyText],
        },
      ],
    };
  } catch (e: any) {
    return {
      markdown: `**Error:** ${e.message}`,
    };
  }
}

// Navigate to page in a transclusion widget
export async function navigateButton(url: string) {
  const pageRef = parsePageRef(url);
  await editor.navigate(pageRef, false, false);
}
