plugs:
	deno run -A --unstable packages/plugos/bin/plugos-bundle.ts --dist dist packages/plugs/global.plug.yaml
	deno run -A --unstable packages/plugos/bin/plugos-bundle.ts --dist packages/plugs/dist --exclude=https://esm.sh/handlebars,https://deno.land/std/encoding/yaml.ts,https://esm.sh/@lezer/lr packages/plugs/*/*.plug.yaml

test:
	deno test -A --unstable

watch:
	deno task watch