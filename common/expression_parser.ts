import type { QueryExpression } from "$sb/types.ts";
import { parseTreeToAST } from "$sb/lib/tree.ts";
import { expressionLanguage } from "$common/template/template_parser.ts";
import { expressionToKvQueryExpression } from "$sb/lib/parse-query.ts";
import { lezerToParseTree } from "$common/markdown_parser/parse_tree.ts";

export function parseExpression(s: string): QueryExpression {
  const ast = parseTreeToAST(
    lezerToParseTree(s, expressionLanguage.parser.parse(s).topNode),
  );
  return expressionToKvQueryExpression(ast[1]);
}
