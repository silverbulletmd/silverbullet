import type { Client } from "./client.ts";
import { parseAssignmentDirective } from "./space_lua/assignment_directive.ts";
import {
  renderLuaCallback,
  renderPageDirective,
} from "./space_lua/render_widget.ts";
import type { LintPagesDeps } from "./space_lint.ts";

export function spaceLintDeps(client: Client): LintPagesDeps {
  return {
    listPageNames: async () =>
      (await client.space.fetchPageList()).map((p) => p.name),
    readPage: (name) => client.space.readPage(name),
    dispatchLint: async (event) =>
      (await client.dispatchAppEventWithSources("editor:lint", event)).map(
        ({ value, listener }) => ({
          listener,
          diagnostics: value,
        }),
      ),
    renderDirective: async (expressionText, pageMeta) =>
      renderPageDirective(
        client,
        expressionText,
        pageMeta,
        await client.clientSystem.pageScopes.tryGet(pageMeta.name),
        {
          assignmentName: parseAssignmentDirective(expressionText)?.name,
        },
      ),
    luaCodeWidget: (lang) => {
      const def = client.clientSystem.luaCodeWidgets.get(lang);
      if (!def) return undefined;
      return (body, pageMeta) =>
        renderLuaCallback(client, def.render, [body, pageMeta.name], pageMeta);
    },
  };
}
