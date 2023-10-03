#!/bin/sh -e

QUERY_GRAMMAR=common/markdown_parser/query.grammar
EXPRESSION_GRAMMAR=common/markdown_parser/expression.grammar
echo "@top Program { Expression }" > $EXPRESSION_GRAMMAR
tail -n +2 $QUERY_GRAMMAR >> $EXPRESSION_GRAMMAR

npx lezer-generator $QUERY_GRAMMAR -o common/markdown_parser/parse-query.js
npx lezer-generator $EXPRESSION_GRAMMAR -o common/markdown_parser/parse-expression.js