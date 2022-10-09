#!/bin/sh

plugos-bundle --dist dist_bundle/_plug --exclude=https://esm.sh/handlebars,https://deno.land/std/encoding/yaml.ts,https://esm.sh/@lezer/lr plugs/*/*.plug.yaml
