.PHONY: build build-for-docker build-linux-ci docker build-server-releases build-server-releases-macos build-cli-releases-rust build-cli-releases-freebsd build-cli-releases-rust-macos clean check fmt test test-e2e test-e2e-release bench generate website install uninstall bundle build-rs build-rs-cli run-rs

build:
	npm run build
	npm run build:plug-compile
	cargo build --release -p silverbullet
	cargo build --release -p sb

setup:
	npm install
	npx playwright install

# Install the `silverbullet` server and `sb` CLI into Cargo's bin directory
# (~/.cargo/bin, normally already on PATH). `cargo install` copies a stable
# release artifact (re-run to update). Set `CARGO_INSTALL_ROOT` or pass
# `--root <dir>` to install elsewhere.
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

# CI: compile each Linux target ONCE, emitting BOTH the raw docker binaries
# (silverbullet-<arch>, consumed by Dockerfile via TARGETARCH) and the
# server/CLI release zips. Replaces the old split where docker.yml and edge.yml
# each recompiled the musl server binaries independently.
build-linux-ci: build-for-docker
	# Server release zips reuse the raw musl binaries built by build-for-docker
	# (no recompile).
	cp silverbullet-amd64 silverbullet && zip silverbullet-server-linux-x86_64.zip silverbullet && rm silverbullet
	cp silverbullet-arm64 silverbullet && zip silverbullet-server-linux-aarch64.zip silverbullet && rm silverbullet
	cp silverbullet-arm   silverbullet && zip silverbullet-server-linux-armv7.zip   silverbullet && rm silverbullet
	# Windows server (no docker image for windows → no raw copy kept)
	cargo build --release -p silverbullet --target x86_64-pc-windows-gnu
	cp target/x86_64-pc-windows-gnu/release/silverbullet.exe silverbullet.exe && zip silverbullet-server-windows-x86_64.zip silverbullet.exe && rm silverbullet.exe
	# sb CLI release zips (musl x3 + windows)
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

# --- Rust standalone server binary (bin/silverbullet) -----------------------
build-rs:
	npm run build
	cargo build --release -p silverbullet
	@echo "Built: target/release/silverbullet"

# --- Rust standalone CLI client (bin/sb) ------------------------------------
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
	rm -rf client_bundl dist target version.json
	rm -f silverbullet silverbullet-arm64 silverbullet-amd64 silverbullet-arm silverbullet.exe silverbullet-server-*.zip sb sb.exe sb-*.zip
	rm -rf plugs/configuration-manager/assets
	rm -rf plugs/object-graph/assets

check:
	npm run check
	npx biome lint .
	cargo fmt --all --check
	cargo clippy --workspace --all-targets --all-features -- -D warnings

fmt:
	npx biome format --write .
	cargo fmt --all

test:
	npx vitest run
	cargo test --workspace --all-features

test-e2e: build-rs
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

