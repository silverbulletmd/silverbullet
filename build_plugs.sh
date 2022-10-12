#!/bin/sh

deno run -A --unstable plugos/bin/plugos-bundle.ts --dist dist_bundle/_plug $1 --exclude=https://esm.sh/handlebars,https://deno.land/std/encoding/yaml.ts,https://esm.sh/@lezer/lr plugs/*/*.plug.yaml
