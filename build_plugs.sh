#!/bin/sh

plugos-bundle --dist dist/web plugs/global.plug.yaml
plugos-bundle --dist plugs/dist --exclude=https://esm.sh/handlebars,https://deno.land/std/encoding/yaml.ts,https://esm.sh/@lezer/lr plugs/*/*.plug.yaml
