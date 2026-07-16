import type { SysCallMapping } from "../system.ts";
import type { CodeWidgetHook } from "../hooks/code_widget.ts";
import type { CodeWidgetContent } from "@silverbulletmd/silverbullet/type/client";

export function codeWidgetSyscalls(
  codeWidgetHook: CodeWidgetHook,
): SysCallMapping {
  return {
    "codeWidget.render": {
      callback: (
        _ctx,
        lang: string,
        body: string,
        pageName: string,
      ): Promise<CodeWidgetContent | null> => {
        const langCallback = codeWidgetHook.codeWidgetCallbacks.get(lang);
        if (!langCallback) {
          throw new Error(`Code widget ${lang} not found`);
        }
        return langCallback(body, pageName);
      },
      description: "Renders code through the widget registered for a language.",
      parameters: [
        { name: "language", type: "string", description: "Widget language." },
        { name: "body", type: "string", description: "Code block body." },
        {
          name: "pageName",
          type: "string",
          description: "Containing page name.",
        },
      ],
      returns: [
        { type: "table", description: "Rendered widget content, or nil." },
      ],
    },
  };
}
