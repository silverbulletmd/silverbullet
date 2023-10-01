import { ParseTree, parseTreeToAST } from "$sb/lib/tree.ts";
import { replaceTemplateVars } from "../template/template.ts";
import { PageMeta } from "$sb/types.ts";
import { expressionToKvQueryExpression } from "$sb/lib/parse-query.ts";
import { evalQueryExpression } from "$sb/lib/query.ts";
import { builtinFunctions } from "$sb/lib/builtin_query_functions.ts";

// This is rather scary and fragile stuff, but it works.
export async function evalDirectiveRenderer(
  _directive: string,
  pageMeta: PageMeta,
  expression: string | ParseTree,
): Promise<string> {
  try {
    const result = evalQueryExpression(
      expressionToKvQueryExpression(parseTreeToAST(
        JSON.parse(
          await replaceTemplateVars(JSON.stringify(expression), pageMeta),
        ),
      )),
      {},
      builtinFunctions,
    );

    return Promise.resolve("" + result);
  } catch (e: any) {
    return Promise.resolve(`**ERROR:** ${e.message}`);
  }
}
