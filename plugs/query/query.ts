import type { WidgetContent } from "$sb/app_event.ts";
import { editor, events, language, markdown, space } from "$sb/syscalls.ts";
import { parseTreeToAST } from "$sb/lib/tree.ts";
import { astToKvQuery } from "$sb/lib/parse-query.ts";
import { jsonToMDTable, renderTemplate } from "../directive/util.ts";
import { renderMarkdownToHtml } from "../markdown/markdown_render.ts";
import { replaceTemplateVars } from "../template/template.ts";
import { prepareJS, wrapHTML } from "./util.ts";

export async function widget(bodyText: string): Promise<WidgetContent> {
  const pageMeta = await space.getPageMeta(await editor.getCurrentPage());

  try {
    const queryAST = parseTreeToAST(
      await language.parseLanguage("query", bodyText),
    );
    const parsedQuery = astToKvQuery(
      JSON.parse(
        await replaceTemplateVars(JSON.stringify(queryAST[1]), pageMeta),
      ),
    );

    const eventName = `query:${parsedQuery.querySource}`;

    let resultMarkdown = "";

    // console.log("Parsed query", parsedQuery);
    // Let's dispatch an event and see what happens
    const results = await events.dispatchEvent(
      eventName,
      { query: parsedQuery, pageName: pageMeta.name },
      30 * 1000,
    );
    if (results.length === 0) {
      // This means there was no handler for the event which means it's unsupported
      return {
        html:
          `**Error:** Unsupported query source '${parsedQuery.querySource}'`,
      };
    } else {
      const allResults = results.flat();
      if (allResults.length === 0) {
        resultMarkdown = "No results";
      } else {
        if (parsedQuery.render) {
          // Configured a custom rendering template, let's use it!
          const rendered = await renderTemplate(
            pageMeta,
            parsedQuery.render,
            allResults,
          );
          resultMarkdown = rendered.trim();
        } else {
          // TODO: At this point it's a bit pointless to first render a markdown table, and then convert that to HTML
          // We should just render the HTML table directly
          resultMarkdown = jsonToMDTable(allResults);
        }
      }
    }

    // Parse markdown to a ParseTree
    const mdTree = await markdown.parseMarkdown(resultMarkdown);
    // And then render it to HTML
    const html = renderMarkdownToHtml(mdTree, { smartHardBreak: true });
    return {
      html: await wrapHTML(`
       ${parsedQuery.render ? "" : `<div class="sb-table-widget">`}
       ${html}
       ${parsedQuery.render ? "" : `</div>`}
      `),
      script: await prepareJS(),
    };
  } catch (e: any) {
    return {
      html: await wrapHTML(`<b>Error:</b> ${e.message}`),
    };
  }
}
