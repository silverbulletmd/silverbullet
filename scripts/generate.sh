#!/bin/sh -e

LUA_GRAMMAR=common/space_lua/lua.grammar
LEZER_GENERATOR_VERSION=1.5.1

# Generate a patched grammer for just expressions
echo "@top Program { Expression }" > $EXPRESSION_GRAMMAR
tail -n +2 $QUERY_GRAMMAR >> $EXPRESSION_GRAMMAR

deno run -A npm:@lezer/generator@$LEZER_GENERATOR_VERSION $LUA_GRAMMAR -o common/space_lua/parse-lua.js