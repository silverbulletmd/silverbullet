LDFLAGS = -X main.buildTime=$$(date -u +%Y-%m-%dT%H:%M:%SZ)
CLI_VERSION = $$(sed -n 's/.*"\([^"]*\)".*/\1/p' public_version.ts)
CLI_LDFLAGS = -X main.version=$(CLI_VERSION)

.PHONY: build build-for-docker docker build-server-releases build-cli-releases clean check fmt test test-integration test-e2e bench generate website

build:
	npm run build
	npm run build:plug-compile
	go build -ldflags "$(LDFLAGS)"
	go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli

setup:
	npm install
	npx playwright install

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
	GOOS=linux GOARCH=arm64 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-linux-aarch64.zip sb && rm sb
	GOOS=linux GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-linux-x86_64.zip sb && rm sb
	GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-linux-armv7.zip sb && rm sb
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-darwin-aarch64.zip sb && rm sb
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-darwin-x86_64.zip sb && rm sb
	GOOS=windows GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o sb.exe ./cmd/cli && zip sb-windows-x86_64.zip sb.exe && rm sb.exe
	GOOS=freebsd GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-freebsd-x86_64.zip sb && rm sb

clean:
	rm -rf  client_bundle/{base_fs,client} dist public_version.ts
	rm -f silverbullet silverbullet-arm64 silverbullet-amd64 silverbullet-arm silverbullet.exe silverbullet-server-*.zip
	rm -f sb sb.exe sb-*.zip
	rm -rf plugs/configuration-manager/assets

check:
	npm run check
	npx biome lint .
	go vet

fmt:
	npx biome format --write .
	go fmt

test:
	npx vitest run
	go test ./server/...

test-integration:
	go test -tags=integration ./server/... ./cli/... -v -timeout 300s

test-e2e: build
	npx playwright test

bench:
	npm run bench

generate:
	npx @lezer/generator@1.5.1 client/space_lua/lua.grammar -o client/space_lua/parse-lua.js

website: build
	SB_INDEX_PAGE=SilverBullet ./silverbullet -p 3001 website

