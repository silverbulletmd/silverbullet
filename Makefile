LDFLAGS = -X main.buildTime=$$(date -u +%Y-%m-%dT%H:%M:%SZ)
CLI_VERSION = $$(sed -n 's/.*"\([^"]*\)".*/\1/p' public_version.ts)
CLI_LDFLAGS = -X main.version=$(CLI_VERSION)

# Where `make install` symlinks the `silverbullet` server binary. Defaults to
# Go's bin directory (GOBIN, or GOPATH/bin), which is typically already on your
# PATH. Override with INSTALL_DIR=/some/dir if you prefer another location.
INSTALL_DIR ?= $(or $(shell go env GOBIN),$(shell go env GOPATH)/bin)

.PHONY: build build-for-docker docker build-server-releases build-server-releases-macos build-cli-releases clean check fmt test test-integration test-e2e test-e2e-release bench generate website install uninstall bundle build-rs run-rs

build:
	npm run build
	npm run build:plug-compile
	go build -ldflags "$(LDFLAGS)"
	go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli

setup:
	npm install
	npx playwright install

# Symlink the freshly built server binary into INSTALL_DIR so you can run
# `silverbullet` from anywhere. Because it's a symlink (not a copy), later
# `make build` runs update the installed binary automatically.
install: build
	mkdir -p "$(INSTALL_DIR)"
	ln -sf "$(CURDIR)/silverbullet" "$(INSTALL_DIR)/silverbullet"
	@echo "Symlinked $(CURDIR)/silverbullet -> $(INSTALL_DIR)/silverbullet"

uninstall:
	rm -f "$(INSTALL_DIR)/silverbullet"
	@echo "Removed $(INSTALL_DIR)/silverbullet"

build-for-docker: build
	GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o silverbullet-arm64 .
	GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o silverbullet-amd64 .
	GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "$(LDFLAGS)" -o silverbullet-arm .

docker: build-for-docker
	docker buildx build --platform linux/arm64,linux/amd64,linux/arm/v7 --push .

build-server-releases:
	npm run build
	cargo zigbuild --release -p silverbullet --target x86_64-unknown-linux-musl
	cp target/x86_64-unknown-linux-musl/release/silverbullet silverbullet && zip silverbullet-server-linux-x86_64.zip silverbullet && rm silverbullet
	cargo zigbuild --release -p silverbullet --target aarch64-unknown-linux-musl
	cp target/aarch64-unknown-linux-musl/release/silverbullet silverbullet && zip silverbullet-server-linux-aarch64.zip silverbullet && rm silverbullet
	cargo zigbuild --release -p silverbullet --target armv7-unknown-linux-musleabihf
	cp target/armv7-unknown-linux-musleabihf/release/silverbullet silverbullet && zip silverbullet-server-linux-armv7.zip silverbullet && rm silverbullet
	cargo zigbuild --release -p silverbullet --target x86_64-pc-windows-gnu
	cp target/x86_64-pc-windows-gnu/release/silverbullet.exe silverbullet.exe && zip silverbullet-server-windows-x86_64.zip silverbullet.exe && rm silverbullet.exe

# macOS server release archives — run on a macOS host (native SDK), builds both arches.
build-server-releases-macos:
	npm run build
	rustup target add aarch64-apple-darwin x86_64-apple-darwin
	cargo build --release -p silverbullet --target aarch64-apple-darwin
	cp target/aarch64-apple-darwin/release/silverbullet silverbullet && zip silverbullet-server-darwin-aarch64.zip silverbullet && rm silverbullet
	cargo build --release -p silverbullet --target x86_64-apple-darwin
	cp target/x86_64-apple-darwin/release/silverbullet silverbullet && zip silverbullet-server-darwin-x86_64.zip silverbullet && rm silverbullet

build-cli-releases:
	GOOS=linux GOARCH=arm64 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-linux-aarch64.zip sb && rm sb
	GOOS=linux GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-linux-x86_64.zip sb && rm sb
	GOOS=linux GOARCH=arm GOARM=7 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-linux-armv7.zip sb && rm sb
	GOOS=darwin GOARCH=arm64 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-darwin-aarch64.zip sb && rm sb
	GOOS=darwin GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-darwin-x86_64.zip sb && rm sb
	GOOS=windows GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o sb.exe ./cmd/cli && zip sb-windows-x86_64.zip sb.exe && rm sb.exe
	GOOS=freebsd GOARCH=amd64 go build -ldflags "$(CLI_LDFLAGS)" -o sb ./cmd/cli && zip sb-freebsd-x86_64.zip sb && rm sb

# --- Rust standalone server binary (bin/silverbullet) -----------------------
build-rs:
	npm run build
	cargo build --release -p silverbullet
	@echo "Built: target/release/silverbullet"

clean:
	rm -rf  client_bundle/{base_fs,client} dist public_version.ts
	rm -f silverbullet silverbullet-arm64 silverbullet-amd64 silverbullet-arm silverbullet.exe silverbullet-server-*.zip
	rm -f sb sb.exe sb-*.zip
	rm -rf plugs/configuration-manager/assets

check:
	npm run check
	npx biome lint .
	go vet
	cargo fmt --all --check
	cargo clippy --workspace --all-targets --all-features -- -D warnings

fmt:
	npx biome format --write .
	go fmt
	cargo fmt --all

test:
	npx vitest run
	go test ./server/...
	cargo test --workspace --all-features

test-integration:
	go test -tags=integration ./server/... ./cli/... -v -timeout 300s

test-e2e: build
	npx playwright test

# Browser E2E tests against the standalone release binary, validating the
# rust-embed embedded client bundle and the browser login flow. Requires a
# release build first: run `make build-rs` to produce
# `target/release/silverbullet`. Kept out of the default `test-e2e` so the
# fast suite isn't blocked on a release build.
test-e2e-release:
	npx playwright test e2e/release-embedded.test.ts

bench:
	npm run bench

generate:
	npx @lezer/generator@1.5.1 client/space_lua/lua.grammar -o client/space_lua/parse-lua.js

website: build-rs
	SB_INDEX_PAGE=SilverBullet SB_DISABLE_SERVICE_WORKER=1 ./target/release/silverbullet -p 3001 website

