#!/bin/sh -e

LUA_GRAMMAR=lib/space_lua/lua.grammar
LEZER_GENERATOR_VERSION=1.5.1

deno run -A npm:@lezer/generator@$LEZER_GENERATOR_VERSION $LUA_GRAMMAR -o lib/space_lua/parse-lua.js