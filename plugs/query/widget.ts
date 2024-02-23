import { codeWidget, editor, events } from "$sb/syscalls.ts";
import { parseQuery } from "$sb/lib/parse-query.ts";
import { loadPageObject, replaceTemplateVars } from "../template/page.ts";
import { resolvePath } from "$sb/lib/resolve.ts";
import { CodeWidgetContent } from "../../type/types.ts";
import { jsonToMDTable, renderQueryTemplate } from "../template/util.ts";
import { renderQuery } from "./api.ts";

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

    const results = await renderQuery(parsedQuery, { page: pageObject });
    if (Array.isArray(results)) {
      resultMarkdown = jsonToMDTable(results);
    } else {
      resultMarkdown = results;
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

export function refreshAllWidgets() {
  codeWidget.refreshAll();
}

export async function editButton(bodyText: string) {
  const text = await editor.getText();
  // This is a it of a heuristic and will point to the wrong place if the same body text appears in multiple places, which is easy to replicate but unlikely to happen in the real world
  // A more accurate fix would be to update the widget (and therefore the index of where this widget appears) on every change, but this would be rather expensive. I think this is good enough.
  const bodyPos = text.indexOf("\n" + bodyText + "\n");
  if (bodyPos === -1) {
    await editor.flashNotification("Could not find widget to edit", "error");
    return;
  }
  await editor.moveCursor(bodyPos + 1);
}
