import type { SysCallMapping } from "../../plugos/system.ts";
import type { Client } from "../../client.ts";
import { reloadAllWidgets } from "../../codemirror/code_widget.ts";
import { broadcastReload } from "../../components/widget_sandbox_iframe.ts";

export function clientCodeWidgetSyscalls(client: Client): SysCallMapping {
  return {
    "codeWidget.refreshAll": {
      callback: () => {
        client.widgetCache.clearPrewarm();
        broadcastReload();
        return reloadAllWidgets();
      },
      description:
        "Refreshes all code widgets on the current page that support refreshing.",
      examples: [{ code: "codeWidget.refreshAll()" }],
    },
  };
}
