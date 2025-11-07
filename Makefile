build:
	# Build client
	deno task build
	# Build plug-compile
	deno task build-plug-compile
	# Build server
	go build

clean:
	rm -rf  client_bundle/{base_fs,client} dist public_version.ts
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

.PHONY: bench
bench:
	# Run frontend tests
	deno task bench

generate:
	# Regenerate the Lua parser from the the grammar
	deno run -A npm:@lezer/generator@1.5.1 client/space_lua/lua.grammar -o client/space_lua/parse-lua.js

.PHONY: website
website: build
	SB_INDEX_PAGE=SilverBullet ./silverbullet -p 3001 website
