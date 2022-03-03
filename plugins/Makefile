DENO_BUNDLE=deno run --allow-read --allow-write --unstable bundle.ts --debug
build: *
	mkdir -p dist
	$(DENO_BUNDLE) core/core.plugin.json ../webapp/src/generated/core.plugin.json

entr:
	ls core/* | entr make