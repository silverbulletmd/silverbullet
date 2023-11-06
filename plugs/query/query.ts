import type { WidgetContent } from "$sb/app_event.ts";
import { events, language, space, system } from "$sb/syscalls.ts";
import { parseTreeToAST } from "$sb/lib/tree.ts";
import { astToKvQuery } from "$sb/lib/parse-query.ts";
import { jsonToMDTable, renderTemplate } from "../directive/util.ts";
import { loadPageObject, replaceTemplateVars } from "../template/template.ts";

export async function widget(
  bodyText: string,
  pageName: string,
): Promise<WidgetContent> {
  const pageObject = await loadPageObject(pageName);

  try {
    const queryAST = parseTreeToAST(
      await language.parseLanguage(
        "query",
        await replaceTemplateVars(bodyText, pageObject),
      ),
    );
    const parsedQuery = astToKvQuery(queryAST[1]);

    const eventName = `query:${parsedQuery.querySource}`;

    let resultMarkdown = "";

    // console.log("Parsed query", parsedQuery);
    // Let's dispatch an event and see what happens
    const results = await events.dispatchEvent(
      eventName,
      { query: parsedQuery, pageName: pageObject.name },
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
            pageObject,
            parsedQuery.render,
            allResults,
            parsedQuery.renderAll!,
          );
          resultMarkdown = rendered.trim();
        } else {
          // TODO: At this point it's a bit pointless to first render a markdown table, and then convert that to HTML
          // We should just render the HTML table directly
          resultMarkdown = jsonToMDTable(allResults);
        }
      }
    }

    return system.invokeFunction(
      "markdown.markdownContentWidget",
      resultMarkdown,
      pageName,
    );
  } catch (e: any) {
    return system.invokeFunction(
      "markdown.markdownContentWidget",
      `**Error:** ${e.message}`,
    );
  }
}
