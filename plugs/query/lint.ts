import type { LintEvent } from "../../plug-api/types.ts";
import { parseQuery } from "../../plug-api/lib/parse_query.ts";
import {
  cleanPageRef,
  resolvePath,
} from "@silverbulletmd/silverbullet/lib/resolve";
import {
  findNodeOfType,
  traverseTreeAsync,
} from "@silverbulletmd/silverbullet/lib/tree";
import { events, space, system } from "@silverbulletmd/silverbullet/syscalls";
import type { LintDiagnostic } from "../../plug-api/types.ts";
import { loadPageObject, replaceTemplateVars } from "../template/page.ts";

export async function lintQuery(
  { name, tree }: LintEvent,
): Promise<LintDiagnostic[]> {
  const diagnostics: LintDiagnostic[] = [];
  const config = await system.getSpaceConfig();
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
          await replaceTemplateVars(bodyText, pageObject, config),
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
            "/" + cleanPageRef(parsedQuery.render),
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
