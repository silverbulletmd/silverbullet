import { FunctionMap } from "$sb/types.ts";
import { DataStore } from "../../plugos/lib/datastore.ts";
import { SysCallMapping } from "../../plugos/system.ts";
import { renderTemplate } from "../template/render.ts";
import { parseTemplate } from "../template/template_parser.ts";

export function templateSyscalls(functionMap: FunctionMap): SysCallMapping {
  return {
    "template.renderTemplate": (
      _ctx,
      template: string,
      obj: any,
      globals: Record<string, any> = {},
    ): Promise<string> => {
      return renderHandlebarsTemplate(template, obj, globals, functionMap);
    },
  };
}

export function renderHandlebarsTemplate(
  template: string,
  obj: any,
  globals: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const parsedTemplate = parseTemplate(template);
  return renderTemplate(parsedTemplate, obj, globals, functionMap);
}
