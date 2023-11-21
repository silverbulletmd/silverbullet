import { SysCallMapping } from "../../plugos/system.ts";
import { broadcastReload } from "../components/widget_sandbox_iframe.ts";

export function clientCodeWidgetSyscalls(): SysCallMapping {
  return {
    "codeWidget.refreshAll": () => {
      broadcastReload();
    },
  };
}
