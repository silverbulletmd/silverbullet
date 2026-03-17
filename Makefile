LDFLAGS = -X main.buildTime=$$(date -u +%Y-%m-%dT%H:%M:%SZ)

.PHONY: build build-for-docker docker build-server-releases clean check fmt test test-integration bench generate website

build:
	# Build client
	npm run build
	# Build plug-compile
	npm run build:plug-compile
	# Build CLI
	npm run build:cli
	# Build server
	go build -ldflags "$(LDFLAGS)"

build-for-docker: build
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o silverbullet-arm64 .
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet-amd64 .

docker: build-for-docker
	docker buildx build --platform linux/arm64,linux/amd64 --push .

build-server-releases:
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-linux-aarch64.zip silverbullet
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-linux-x86_64.zip silverbullet
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-darwin-aarch64.zip silverbullet
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-darwin-x86_64.zip silverbullet
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet.exe . && zip silverbullet-server-windows-x86_64.zip silverbullet.exe
	GOOS=freebsd GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-freebsd-x86_64.zip silverbullet

clean:
	rm -rf  client_bundle/{base_fs,client} dist public_version.ts
	rm -f silverbullet silverbullet-arm64 silverbullet-amd64 silverbullet.exe silverbullet-server-*.zip

check:
	# Frontend type check
	npm run check
	# Frontend lint
	npx biome lint .
	# Backend lint
	go vet

fmt:
	# Reformat frontend
	npx biome format --write .
	# Reformat backend
	go fmt

test:
	# Run frontend tests
	npx vitest run
	# Run backend tests
	go test ./server/...

test-integration:
	# Run headless Chrome integration tests (requires Chrome installed)
	go test -tags=integration ./server/... -v -timeout 300s

bench:
	# Run frontend benchmarks
	npm run bench

generate:
	# Regenerate the Lua parser from the the grammar
	npx @lezer/generator@1.5.1 client/space_lua/lua.grammar -o client/space_lua/parse-lua.js

website: build
	SB_INDEX_PAGE=SilverBullet ./silverbullet -p 3001 website
