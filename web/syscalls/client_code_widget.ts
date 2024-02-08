import { SysCallMapping } from "../../lib/plugos/system.ts";
import { reloadAllMarkdownWidgets } from "../cm_plugins/markdown_widget.ts";
import { broadcastReload } from "../components/widget_sandbox_iframe.ts";

export function clientCodeWidgetSyscalls(): SysCallMapping {
  return {
    "codeWidget.refreshAll": () => {
      broadcastReload();
      reloadAllMarkdownWidgets();
    },
  };
}
