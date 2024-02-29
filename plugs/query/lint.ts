import { LintEvent } from "../../plug-api/types.ts";
import { parseQuery } from "$sb/lib/parse-query.ts";
import { cleanPageRef, resolvePath } from "$sb/lib/resolve.ts";
import { findNodeOfType, traverseTreeAsync } from "$sb/lib/tree.ts";
import { events, space } from "$sb/syscalls.ts";
import { LintDiagnostic } from "../../plug-api/types.ts";
import { loadPageObject, replaceTemplateVars } from "../template/page.ts";

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
