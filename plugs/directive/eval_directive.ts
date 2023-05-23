// This is some shocking stuff. My profession would kill me for this.

import { YAML } from "$sb/plugos-syscall/mod.ts";
import { ParseTree } from "$sb/lib/tree.ts";
import { jsonToMDTable, renderTemplate } from "./util.ts";

// Enables plugName.functionName(arg1, arg2) syntax in JS expressions
function translateJs(js: string): string {
  return js.replaceAll(
    /(\w+\.\w+)\s*\(/g,
    'await invokeFunction("$1", ',
  );
}

// Syntaxes to support:
// - random JS expression
// - random JS expression render [[some/template]]
const expressionRegex = /(.+?)(\s+render\s+\[\[([^\]]+)\]\])?$/;

// This is rather scary and fragile stuff, but it works.
export async function evalDirectiveRenderer(
  _directive: string,
  _pageName: string,
  expression: string | ParseTree,
): Promise<string> {
  if (typeof expression !== "string") {
    throw new Error("Expected a string");
  }
  console.log("Got JS expression", expression);
  const match = expressionRegex.exec(expression);
  if (!match) {
    throw new Error(`Invalid eval directive: ${expression}`);
  }
  let template = "";
  if (match[3]) {
    // This is the template reference
    expression = match[1];
    template = match[3];
  }
  try {
    // Why the weird "eval" call? https://esbuild.github.io/content-types/#direct-eval
    const result = await (0, eval)(
      `(async () => { 
        function invokeFunction(name, ...args) {
          return syscall("system.invokeFunction", "server", name, ...args);
        }
        return ${translateJs(expression)};
      })()`,
    );
    if (template) {
      return await renderTemplate(template, result);
    }
    if (typeof result === "string") {
      return result;
    } else if (typeof result === "number") {
      return "" + result;
    } else if (Array.isArray(result)) {
      return jsonToMDTable(result);
    }
    return await YAML.stringify(result);
  } catch (e: any) {
    return `**ERROR:** ${e.message}`;
  }
}
