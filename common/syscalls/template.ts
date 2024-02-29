import { FunctionMap } from "../../plug-api/types.ts";
import { AST } from "../../plug-api/lib/tree.ts";
import { SysCallMapping } from "$lib/plugos/system.ts";
import { renderTemplate } from "$common/template/render.ts";
import { parseTemplate } from "$common/template/template_parser.ts";
import { DataStore } from "$lib/data/datastore.ts";

export function templateSyscalls(ds: DataStore): SysCallMapping {
  return {
    "template.renderTemplate": (
      _ctx,
      template: string,
      obj: any,
      globals: Record<string, any> = {},
    ): Promise<string> => {
      return renderTheTemplate(template, obj, globals, ds.functionMap);
    },
    "template.parseTemplate": (
      _ctx,
      template: string,
    ): AST => {
      return parseTemplate(template);
    },
  };
}

export function renderTheTemplate(
  template: string,
  obj: any,
  globals: Record<string, any>,
  functionMap: FunctionMap,
): Promise<string> {
  const parsedTemplate = parseTemplate(template);
  return renderTemplate(parsedTemplate, obj, globals, functionMap);
}
