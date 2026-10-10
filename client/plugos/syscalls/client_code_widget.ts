import type { Client } from "../../client.ts";
import { reloadAllWidgets } from "../../codemirror/widgets/code_widget.ts";
import { broadcastReload } from "../../sandbox/widget_sandbox_iframe.ts";
import type { SysCallMapping } from "../../plugos/system.ts";

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
