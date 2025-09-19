build:
	# Build frontend
	deno task build
	# Build plug-compile
	deno task build-plug-compile
	# Build backend
	go build

clean:
	deno task clean
	rm -f silverbullet

check:
	# Frontend type check
	deno task check
	# Frontend lint
	deno task lint
	# Backend lint
	go vet

fmt:
	# Reformat frontend
	deno task fmt
	# Reformat backend
	go fmt

test:
	# Run frontend tests
	deno task test
	# Run backend tests
	go test ./server/...

generate:
	# Regenerate the Lua parser from the the grammar
	deno run -A npm:@lezer/generator@1.5.1 lib/space_lua/lua.grammar -o lib/space_lua/parse-lua.js
