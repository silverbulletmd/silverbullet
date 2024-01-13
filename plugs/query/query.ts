import type { LintEvent } from "$sb/app_event.ts";
import { events, space } from "$sb/syscalls.ts";
import { findNodeOfType, traverseTreeAsync } from "$sb/lib/tree.ts";
import { parseQuery } from "$sb/lib/parse-query.ts";
import { loadPageObject, replaceTemplateVars } from "../template/template.ts";
import { cleanPageRef, resolvePath } from "$sb/lib/resolve.ts";
import {
  CodeWidgetContent,
  LintDiagnostic,
  PageMeta,
  Query,
} from "$sb/types.ts";
import { jsonToMDTable, renderQueryTemplate } from "../template/util.ts";

export async function widget(
  bodyText: string,
  pageName: string,
): Promise<CodeWidgetContent> {
  const pageObject = await loadPageObject(pageName);
  try {
    let resultMarkdown = "";
    const parsedQuery = await parseQuery(
      await replaceTemplateVars(bodyText, pageObject),
    );

    const results = await performQuery(
      parsedQuery,
      pageObject,
    );
    if (results.length === 0 && !parsedQuery.renderAll) {
      resultMarkdown = "No results";
    } else {
      if (parsedQuery.render) {
        // Configured a custom rendering template, let's use it!
        const templatePage = resolvePath(pageName, parsedQuery.render);
        const rendered = await renderQueryTemplate(
          pageObject,
          templatePage,
          results,
          parsedQuery.renderAll!,
        );
        resultMarkdown = rendered.trim();
      } else {
        // TODO: At this point it's a bit pointless to first render a markdown table, and then convert that to HTML
        // We should just render the HTML table directly
        resultMarkdown = jsonToMDTable(results);
      }
    }

    return {
      markdown: resultMarkdown,
      buttons: [
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
    return { markdown: `**Error:** ${e.message}` };
  }
}

export async function performQuery(parsedQuery: Query, pageObject: PageMeta) {
  if (!parsedQuery.limit) {
    parsedQuery.limit = ["number", 1000];
  }

  const eventName = `query:${parsedQuery.querySource}`;
  // console.log("Parsed query", parsedQuery);
  // Let's dispatch an event and see what happens
  const results = await events.dispatchEvent(
    eventName,
    { query: parsedQuery, pageName: pageObject.name },
    30 * 1000,
  );
  if (results.length === 0) {
    throw new Error(`Unsupported query source '${parsedQuery.querySource}'`);
  }
  return results.flat();
}

export async function lintQuery(
  { name, tree }: LintEvent,
): Promise<LintDiagnostic[]> {
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
        const pageObject = await loadPageObject(name);
        const parsedQuery = await parseQuery(
          await replaceTemplateVars(bodyText, pageObject),
        );

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
          } catch {
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
