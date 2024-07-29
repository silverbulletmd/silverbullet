import { PageDecoration, PageMeta } from "$sb/types.ts";
import { SysCallMapping } from "$lib/plugos/system.ts";
import { Client } from "../client.ts";
import { evalQueryExpression } from "$sb/lib/query_expression.ts";
import { builtinFunctions } from "$lib/builtin_query_functions.ts";
import { parseExpression } from "$common/expression_parser.ts";

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
                decoration.whereParsed = parseExpression(decoration.where);
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
