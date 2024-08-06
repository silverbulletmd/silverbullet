import type { QueryExpression } from "@silverbulletmd/silverbullet/types";
import { parseTreeToAST } from "@silverbulletmd/silverbullet/lib/tree";
import { expressionLanguage } from "$common/template/template_parser.ts";
import { expressionToKvQueryExpression } from "@silverbulletmd/silverbullet/lib/parse_query";
import { lezerToParseTree } from "$common/markdown_parser/parse_tree.ts";

export function parseExpression(s: string): QueryExpression {
  const ast = parseTreeToAST(
    lezerToParseTree(s, expressionLanguage.parser.parse(s).topNode),
  );
  return expressionToKvQueryExpression(ast[1]);
}
