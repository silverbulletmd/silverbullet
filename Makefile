.PHONY: plugs
plugs:
	deno run -A --unstable plugos/bin/plugos-bundle.ts --dist dist plugs/global.plug.yaml
	deno run -A --unstable plugos/bin/plugos-bundle.ts --dist plugs/dist --exclude=https://esm.sh/handlebars,https://deno.land/std/encoding/yaml.ts,https://esm.sh/@lezer/lr plugs/*/*.plug.yaml

test:
	deno test -A --unstable

watch:
	deno task watch