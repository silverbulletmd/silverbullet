import { CodeWidgetContent } from "../../plug-api/types.ts";
import { SysCallMapping } from "../../lib/plugos/system.ts";
import { CodeWidgetHook } from "../hooks/code_widget.ts";

export function codeWidgetSyscalls(
  codeWidgetHook: CodeWidgetHook,
): SysCallMapping {
  return {
    "codeWidget.render": (
      _ctx,
      lang: string,
      body: string,
      pageName: string,
    ): Promise<CodeWidgetContent | null> => {
      const langCallback = codeWidgetHook.codeWidgetCallbacks.get(
        lang,
      );
      if (!langCallback) {
        throw new Error(`Code widget ${lang} not found`);
      }
      return langCallback(body, pageName);
    },
  };
}
