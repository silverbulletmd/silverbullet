import type { SysCallMapping } from "../../plugos/system.ts";
import { reloadAllWidgets } from "../../codemirror/code_widget.ts";
import { broadcastReload } from "../../components/widget_sandbox_iframe.ts";

export function clientCodeWidgetSyscalls(): SysCallMapping {
  return {
    "codeWidget.refreshAll": () => {
      broadcastReload();
      return reloadAllWidgets();
    },
  };
}
