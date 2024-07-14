import { PageDecoration, PageMeta } from "$sb/types.ts";
import { SysCallMapping } from "$lib/plugos/system.ts";
import { Client } from "../client.ts";
import { parseTreeToAST } from "$sb/lib/tree.ts";
import { lezerToParseTree } from "$common/markdown_parser/parse_tree.ts";
import { expressionLanguage } from "$common/template/template_parser.ts";
import { expressionToKvQueryExpression } from "$sb/lib/parse-query.ts";
import { evalQueryExpression } from "$sb/lib/query_expression.ts";
import { builtinFunctions } from "$lib/builtin_query_functions.ts";

export function decorationSyscalls(
    client: Client,
): SysCallMapping {
    return {
        "decoration.applyDecorationsToPages": (
            _ctx,
            pages: PageMeta[],
        ): PageMeta[] => {
            if (client.settings.pageDecorations) {
                for (const pageMeta of pages) {
                    decoratePageMeta(pageMeta, client.settings.pageDecorations);
                }
            }
            return pages;
        },
    };
}

/**
 * Decorates (= attaches a pageDecoration field) to the pageMeta object when a matching decorator is found
 */
export function decoratePageMeta(
    pageMeta: PageMeta,
    decorations: PageDecoration[],
) {
    if (!pageMeta) {
        return;
    }
    for (const decoration of decorations) {
        if (!decoration.where) {
            continue;
        }
        // whereParsed is effectively a cached version of the parsed where expression
        // Let's check if it's populated
        if (!decoration.whereParsed) {
            // If not, populate it
            try {
                const ast = parseTreeToAST(lezerToParseTree(
                    decoration.where,
                    expressionLanguage.parser.parse(decoration.where).topNode,
                ));
                decoration.whereParsed = expressionToKvQueryExpression(
                    ast[1],
                );
            } catch (e: any) {
                console.error(
                    "Failed to parse 'where' expression in decoration:",
                    e,
                );
                continue;
            }
        }
        if (
            evalQueryExpression(
                decoration.whereParsed,
                pageMeta,
                {},
                builtinFunctions,
            )
        ) {
            pageMeta.pageDecoration = decoration;
        }
    }
}
