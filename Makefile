.PHONY: build build-e2e build-for-docker build-linux-ci docker build-server-releases build-server-releases-macos build-server-releases-freebsd build-cli-releases-rust build-cli-releases-freebsd build-cli-releases-rust-macos clean check fmt test test-e2e test-browser test-e2e-all test-e2e-release test-e2e-oidc bench generate website install uninstall bundle build-rs build-rs-cli run-rs

build:
	npm run build
	npm run build:plug-compile
	cargo build --release -p silverbullet
	cargo build --release -p sb

# Debug rust-embed serves the client bundle from disk. Embedded assets are
# covered separately by test-e2e-release.
build-e2e:
	npm run build
	cargo build -p silverbullet -p sb

setup:
	npm install
	npx playwright install

# cargo install puts stable release binaries on PATH; set CARGO_INSTALL_ROOT
# to override the default ~/.cargo location.
install:
	cargo install --path bin/silverbullet --force
	cargo install --path bin/sb --force

uninstall:
	cargo uninstall silverbullet
	cargo uninstall sb

build-for-docker:
	npm run build
	cargo build --release -p silverbullet --target aarch64-unknown-linux-musl
	cp target/aarch64-unknown-linux-musl/release/silverbullet silverbullet-arm64
	cargo build --release -p silverbullet --target x86_64-unknown-linux-musl
	cp target/x86_64-unknown-linux-musl/release/silverbullet silverbullet-amd64
	cargo build --release -p silverbullet --target armv7-unknown-linux-musleabihf
	cp target/armv7-unknown-linux-musleabihf/release/silverbullet silverbullet-arm

# Build each Linux target once for both Docker binaries and release archives.
build-linux-ci: build-for-docker
	cp silverbullet-amd64 silverbullet && zip silverbullet-server-linux-x86_64.zip silverbullet && rm silverbullet
	cp silverbullet-arm64 silverbullet && zip silverbullet-server-linux-aarch64.zip silverbullet && rm silverbullet
	cp silverbullet-arm   silverbullet && zip silverbullet-server-linux-armv7.zip   silverbullet && rm silverbullet
	cargo build --release -p silverbullet --target x86_64-pc-windows-gnu
	cp target/x86_64-pc-windows-gnu/release/silverbullet.exe silverbullet.exe && zip silverbullet-server-windows-x86_64.zip silverbullet.exe && rm silverbullet.exe
	$(MAKE) build-cli-releases-rust

docker: build-for-docker
	docker buildx build --platform linux/arm64,linux/amd64,linux/arm/v7 --push .

# Cross-compiled (native `cargo build --target`, no cargo-zigbuild). The linker/CC
# wiring is in `.cargo/config.toml`; install the (apt-only) cross-toolchains
# first. On Debian/Ubuntu:
#   sudo apt-get install -y musl-tools gcc-aarch64-linux-gnu \
#                           gcc-arm-linux-gnueabihf gcc-mingw-w64-x86-64
# The ARM linux targets use the GNU cross-gcc to compile ring's C + drive the
# link; Rust supplies the static musl libc itself (self-contained), so the
# output is a static musl binary. (rustup target add the four triples below first.)
build-server-releases:
	npm run build
	cargo build --release -p silverbullet --target x86_64-unknown-linux-musl
	cp target/x86_64-unknown-linux-musl/release/silverbullet silverbullet && zip silverbullet-server-linux-x86_64.zip silverbullet && rm silverbullet
	cargo build --release -p silverbullet --target aarch64-unknown-linux-musl
	cp target/aarch64-unknown-linux-musl/release/silverbullet silverbullet && zip silverbullet-server-linux-aarch64.zip silverbullet && rm silverbullet
	cargo build --release -p silverbullet --target armv7-unknown-linux-musleabihf
	cp target/armv7-unknown-linux-musleabihf/release/silverbullet silverbullet && zip silverbullet-server-linux-armv7.zip silverbullet && rm silverbullet
	cargo build --release -p silverbullet --target x86_64-pc-windows-gnu
	cp target/x86_64-pc-windows-gnu/release/silverbullet.exe silverbullet.exe && zip silverbullet-server-windows-x86_64.zip silverbullet.exe && rm silverbullet.exe

# macOS server release archives — run on a macOS host (native SDK), builds both arches.
build-server-releases-macos:
	npm run build
	rustup target add aarch64-apple-darwin x86_64-apple-darwin
	cargo build --release -p silverbullet --target aarch64-apple-darwin
	cp target/aarch64-apple-darwin/release/silverbullet silverbullet && zip silverbullet-server-darwin-aarch64.zip silverbullet && rm silverbullet
	cargo build --release -p silverbullet --target x86_64-apple-darwin
	cp target/x86_64-apple-darwin/release/silverbullet silverbullet && zip silverbullet-server-darwin-x86_64.zip silverbullet && rm silverbullet

build-server-releases-freebsd:
	cargo build --release -p silverbullet --target x86_64-unknown-freebsd
	cp target/x86_64-unknown-freebsd/release/silverbullet silverbullet && zip silverbullet-server-freebsd-x86_64.zip silverbullet && rm silverbullet

build-rs:
	npm run build
	cargo build --release -p silverbullet
	@echo "Built: target/release/silverbullet"

build-rs-cli:
	cargo build --release -p sb
	@echo "Built: target/release/sb"

# Rust `sb` CLI release archives (native `cargo build --target`, no zigbuild —
# same cross-toolchains as `build-server-releases`; see its comment). Asset names
# match what `sb upgrade` downloads: sb-<os>-<arch>.zip.
build-cli-releases-rust:
	cargo build --release -p sb --target x86_64-unknown-linux-musl
	cp target/x86_64-unknown-linux-musl/release/sb sb && zip sb-linux-x86_64.zip sb && rm sb
	cargo build --release -p sb --target aarch64-unknown-linux-musl
	cp target/aarch64-unknown-linux-musl/release/sb sb && zip sb-linux-aarch64.zip sb && rm sb
	cargo build --release -p sb --target armv7-unknown-linux-musleabihf
	cp target/armv7-unknown-linux-musleabihf/release/sb sb && zip sb-linux-armv7.zip sb && rm sb
	cargo build --release -p sb --target x86_64-pc-windows-gnu
	cp target/x86_64-pc-windows-gnu/release/sb.exe sb.exe && zip sb-windows-x86_64.zip sb.exe && rm sb.exe

# FreeBSD `sb` CLI release archive — kept SEPARATE because it needs a clang +
# FreeBSD-sysroot cross setup (no apt cross-gcc exists), unlike the apt-only
# targets above. Requires: clang lld llvm + a FreeBSD base sysroot at
# /opt/freebsd-sysroot (see edge.yml / .cargo/config.toml).
build-cli-releases-freebsd:
	cargo build --release -p sb --target x86_64-unknown-freebsd
	cp target/x86_64-unknown-freebsd/release/sb sb && zip sb-freebsd-x86_64.zip sb && rm sb

# macOS `sb` CLI release archives — run on a macOS host (native SDK), both arches.
build-cli-releases-rust-macos:
	rustup target add aarch64-apple-darwin x86_64-apple-darwin
	cargo build --release -p sb --target aarch64-apple-darwin
	cp target/aarch64-apple-darwin/release/sb sb && zip sb-darwin-aarch64.zip sb && rm sb
	cargo build --release -p sb --target x86_64-apple-darwin
	cp target/x86_64-apple-darwin/release/sb sb && zip sb-darwin-x86_64.zip sb && rm sb

clean:
	rm -rf client_bundle dist target version.json
	rm -f silverbullet silverbullet-arm64 silverbullet-amd64 silverbullet-arm silverbullet.exe silverbullet-server-*.zip sb sb.exe sb-*.zip
	rm -rf plugs/configuration-manager/assets
	rm -rf plugs/object-graph/assets

check:
	npm run check
	npx biome lint .
	npm run fmt:check
	cargo fmt --all --check
	cargo clippy --workspace --all-targets --all-features -- -D warnings

fmt:
	npx biome format --write .
	cargo fmt --all

test:
	npx vitest run
	cargo test --workspace --all-features

test-e2e-oidc: build-e2e
	npx playwright test --config=playwright.oidc.config.ts

test-browser:
	npm run build
	npx playwright test --config=playwright.browser.config.ts

test-e2e: build-e2e
	npx playwright test --project=chromium $(E2E_ARGS)

# The same suite on all three engines. CI gates on chromium only; run this
# before a release to catch firefox/webkit regressions. Needs the extra
# engines installed (`npx playwright install`, part of `make setup`).
test-e2e-all: build-e2e
	npx playwright test --project=chromium --project=firefox --project=webkit

# Browser E2E tests against the standalone release binary, validating the
# rust-embed embedded client bundle and the browser login flow. Builds the
# release binary first (`target/release/silverbullet`). Kept out of the default
# `test-e2e` so the fast suite isn't blocked on a release build.
test-e2e-release: build-rs
	npx playwright test --project=release

bench:
	npm run bench

generate:
	npx @lezer/generator@1.5.1 client/space_lua/lua.grammar -o client/space_lua/parse-lua.js

edit-docs: build-rs
	SB_INDEX_PAGE=SilverBullet SB_DISABLE_SERVICE_WORKER=1 ./target/release/silverbullet -p 3001 docs
