import type { LintEvent, WidgetContent } from "$sb/app_event.ts";
import { events, language, space, system } from "$sb/syscalls.ts";
import {
  findNodeOfType,
  parseTreeToAST,
  traverseTreeAsync,
} from "$sb/lib/tree.ts";
import { astToKvQuery } from "$sb/lib/parse-query.ts";
import { jsonToMDTable, renderQueryTemplate } from "../directive/util.ts";
import { loadPageObject, replaceTemplateVars } from "../template/template.ts";
import { cleanPageRef, resolvePath } from "$sb/lib/resolve.ts";
import { LintDiagnostic } from "$sb/types.ts";

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

    if (!parsedQuery.limit) {
      parsedQuery.limit = ["number", 1000];
    }

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
          const templatePage = resolvePath(pageName, parsedQuery.render);
          const rendered = await renderQueryTemplate(
            pageObject,
            templatePage,
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

export async function lintQuery(
  { name, tree }: LintEvent,
): Promise<LintDiagnostic[]> {
  const pageObject = await loadPageObject(name);
  const diagnostics: LintDiagnostic[] = [];
  await traverseTreeAsync(tree, async (node) => {
    if (node.type === "FencedCode") {
      const codeInfo = findNodeOfType(node, "CodeInfo")!;
      if (!codeInfo) {
        return true;
      }
      const codeLang = codeInfo.children![0].text!;
      if (
        codeLang !== "query"
      ) {
        return true;
      }
      const codeText = findNodeOfType(node, "CodeText");
      if (!codeText) {
        return true;
      }
      const bodyText = codeText.children![0].text!;
      try {
        const queryAST = parseTreeToAST(
          await language.parseLanguage(
            "query",
            await replaceTemplateVars(bodyText, pageObject),
          ),
        );
        const parsedQuery = astToKvQuery(queryAST[1]);
        const allSources = await allQuerySources();
        if (
          parsedQuery.querySource &&
          !allSources.includes(parsedQuery.querySource)
        ) {
          diagnostics.push({
            from: codeText.from!,
            to: codeText.to!,
            message: `Unknown query source '${parsedQuery.querySource}'`,
            severity: "error",
          });
        }
        if (parsedQuery.render) {
          const templatePage = resolvePath(
            name,
            cleanPageRef(parsedQuery.render),
          );
          try {
            await space.getPageMeta(templatePage);
          } catch (e: any) {
            diagnostics.push({
              from: codeText.from!,
              to: codeText.to!,
              message: `Could not resolve template ${templatePage}`,
              severity: "error",
            });
          }
        }
      } catch (e: any) {
        diagnostics.push({
          from: codeText.from!,
          to: codeText.to!,
          message: e.message,
          severity: "error",
        });
      }
    }
    return false;
  });
  return diagnostics;
}

async function allQuerySources(): Promise<string[]> {
  const allEvents = await events.listEvents();

  const allSources = allEvents
    .filter((eventName) =>
      eventName.startsWith("query:") && !eventName.includes("*")
    )
    .map((source) => source.substring("query:".length));

  const allObjectTypes: string[] = (await events.dispatchEvent("query_", {}))
    .flat();

  return [...allSources, ...allObjectTypes];
}
