import { SysCallMapping } from "../../plugos/system.ts";
import { handlebarHelpers } from "./handlebar_helpers.ts";
import Handlebars from "handlebars";

export function handlebarsSyscalls(): SysCallMapping {
  return {
    "handlebars.renderTemplate": (
      _ctx,
      template: string,
      obj: any,
      globals: Record<string, any> = {},
    ): string => {
      const templateFn = Handlebars.compile(
        template,
        { noEscape: true },
      );
      return templateFn(obj, {
        helpers: handlebarHelpers(),
        data: globals,
      });
    },
  };
}
