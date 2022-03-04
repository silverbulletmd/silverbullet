BUILD=../plugbox/bin/plugbox-bundle.mjs

core: *
	${BUILD} --debug core/core.plug.json ../webapp/src/generated/core.plug.json

watch: *
	ls -d core/* | entr make