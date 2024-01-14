import { handlebarHelpers } from "./handlebar_helpers.ts";
import Handlebars from "handlebars";

export function handlebarsSyscalls() {
  return {
    "handlebars.renderTemplate": (
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
