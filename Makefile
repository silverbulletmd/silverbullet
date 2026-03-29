LDFLAGS = -X main.buildTime=$$(date -u +%Y-%m-%dT%H:%M:%SZ)
CLI_VERSION = $$(sed -n 's/.*"\([^"]*\)".*/\1/p' public_version.ts)
CLI_LDFLAGS = -X main.version=$(CLI_VERSION)

.PHONY: build build-for-docker docker build-server-releases build-cli-releases clean check fmt test test-integration test-e2e bench generate website

build:
	# Build client
	npm run build
	# Build plug-compile
	npm run build:plug-compile
	# Build server
	go build -ldflags "$(LDFLAGS)"
	# Build Go CLI
	go build -ldflags "$(CLI_LDFLAGS)" -o silverbullet-cli ./cmd/cli

build-for-docker: build
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o silverbullet-arm64 .
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet-amd64 .
	GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "$(LDFLAGS)" -o silverbullet-arm .

docker: build-for-docker
	docker buildx build --platform linux/arm64,linux/amd64,linux/arm/v7 --push .

build-server-releases:
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-linux-aarch64.zip silverbullet
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-linux-x86_64.zip silverbullet
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-darwin-aarch64.zip silverbullet
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-darwin-x86_64.zip silverbullet
	GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet.exe . && zip silverbullet-server-windows-x86_64.zip silverbullet.exe
	GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-linux-armv7.zip silverbullet
	GOOS=freebsd GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet . && zip silverbullet-server-freebsd-x86_64.zip silverbullet

build-cli-releases:
	GOOS=linux GOARCH=arm64 go build -ldflags "$(CLI_LDFLAGS)" -o silverbullet-cli ./cmd/cli && zip silverbullet-cli-linux-aarch64.zip silverbullet-cli && rm silverbullet-cli
	GOOS=linux GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o silverbullet-cli ./cmd/cli && zip silverbullet-cli-linux-x86_64.zip silverbullet-cli && rm silverbullet-cli
	GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "$(CLI_LDFLAGS)" -o silverbullet-cli ./cmd/cli && zip silverbullet-cli-linux-armv7.zip silverbullet-cli && rm silverbullet-cli
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(CLI_LDFLAGS)" -o silverbullet-cli ./cmd/cli && zip silverbullet-cli-darwin-aarch64.zip silverbullet-cli && rm silverbullet-cli
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o silverbullet-cli ./cmd/cli && zip silverbullet-cli-darwin-x86_64.zip silverbullet-cli && rm silverbullet-cli
	GOOS=windows GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o silverbullet-cli.exe ./cmd/cli && zip silverbullet-cli-windows-x86_64.zip silverbullet-cli.exe && rm silverbullet-cli.exe
	GOOS=freebsd GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o silverbullet-cli ./cmd/cli && zip silverbullet-cli-freebsd-x86_64.zip silverbullet-cli && rm silverbullet-cli

clean:
	rm -rf  client_bundle/{base_fs,client} dist public_version.ts
	rm -f silverbullet silverbullet-arm64 silverbullet-amd64 silverbullet-arm silverbullet.exe silverbullet-server-*.zip
	rm -f silverbullet-cli silverbullet-cli.exe silverbullet-cli-*.zip

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
	go test -tags=integration ./server/... ./cli/... -v -timeout 300s

test-e2e: build
	npx playwright test

bench:
	# Run frontend benchmarks
	npm run bench

generate:
	# Regenerate the Lua parser from the the grammar
	npx @lezer/generator@1.5.1 client/space_lua/lua.grammar -o client/space_lua/parse-lua.js

website: build
	SB_INDEX_PAGE=SilverBullet ./silverbullet -p 3001 website
