#development

SilverBullet development can happen at various level.

At its most basic level, you can do a lot using [[Space Lua]]. If this does not give enough power, you can upgrade to [[Plugs]]. If _that_ doesn’t suffice, you can contribute to SilverBullet’s core (see below).

# Stack
SilverBullet’s client is written in [TypeScript](https://www.typescriptlang.org/) and built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor component. Additional UI is built using [Preact](https://preactjs.com/). [ES Build](https://esbuild.github.io) is used to build the frontend.

[[Plugs]] are also written in TypeScript.

The SilverBullet server is written in [Rust](https://www.rust-lang.org/) (a Cargo workspace).

# Code structure
* `client/`: The SilverBullet client, implemented with TypeScript
* `server/`: The SilverBullet server library (Rust): HTTP router, handlers, auth, runtime seam
* `server-common/`: Shared Rust crate (space primitives, shared types)
* `server-runtime-chrome/`: Headless-Chrome runtime backend (Rust)
* `bin/silverbullet/`: The standalone server binary (Rust)
* `bin/sb/`: The `sb` command-line client (Rust)
* `plugs`: Set of built-in plugs that are distributed with SilverBullet
* `libraries`: A set of libraries (space scripts, page templates, slash templates) distributed with SilverBullet
* `plug-api/`: Useful APIs for use in plugs
  * `lib/`: Useful libraries to be used in plugs
  * `syscalls/`: TypeScript wrappers around syscalls
  * `types/`: Various (client) types that can be references from plugs
* `bin/plug-compile.ts`: the plug compiler
* `scripts/`: Useful scripts
* `website/`: silverbullet.md website content

# Development
Requirements:
* [Node.js](https://nodejs.org/) 24.13 or newer (see `.nvmrc`)
* [Rust](https://www.rust-lang.org/tools/install) (stable, via `rustup`)
* Make

Install dependencies once:

```shell
make setup
```

## Server vs. client

SilverBullet has two halves you rebuild **independently** — knowing which one you changed saves time:

* The **server** (Rust: `server/`, `server-common/`, `server-runtime-chrome/`, `bin/silverbullet/`) is a compiled binary.
* The **client** (TypeScript: `client/`) is built by ESBuild into `client_bundle/`, which the server serves.

Run the server in development with `cargo run`. A **debug** build serves the client bundle **live from `client_bundle/` on disk** (a release build embeds it). Use `SB_DISABLE_SERVICE_WORKER=1` so the service worker doesn't cache stale assets:

```shell
SB_DISABLE_SERVICE_WORKER=1 cargo run -p silverbullet -- <PATH-TO-YOUR-SPACE>
```

To pass arguments like `-p` or `-L`, put them after `--`:

```shell
SB_DISABLE_SERVICE_WORKER=1 cargo run -p silverbullet -- -L 0.0.0.0 <PATH-TO-YOUR-SPACE>
```

**When you change the server** (any Rust code): rebuild **and restart** it — stop the process and re-run `cargo run` (it recompiles). A running server does *not* pick up source changes.

**When you change only the client** (TypeScript in `client/`): you do **not** need to restart the server. Rebuild just the client and reload the page in your browser — the debug server serves the new bundle from disk:

```shell
npm run build:client   # rebuild only the client; then reload the page
```

(For plugs, use `npm run build:plugs`; `npm run build` does both.)

To build a self-contained **release** binary (with the client bundle embedded) and run it:

```shell
make build-rs          # -> target/release/silverbullet
./target/release/silverbullet <PATH-TO-YOUR-SPACE>
```

### Useful development tasks

```shell
# Clean all generated files
make clean
# Typecheck and lint all code
make check
# Format all code
make fmt
# Run all tests
make test
```

### Docker
Multi-arch (amd64 + arm64 + arm/v7) Docker images are published to Docker Hub
and the GitHub Container Registry. The **edge** channel is rebuilt on every push
to `main`; **stable** images come from git tags:

* `zefhemel/silverbullet:v2` (edge) / `:latest` + `:X.Y.Z` (stable) — the server
  (Alpine, static musl binary)
* `…:v2-runtime-api` (edge) / `:latest-runtime-api` + `:X.Y.Z-runtime-api`
  (stable) — the same, plus Chromium for the server-side Lua runtime
  (`/.runtime/*`)

Both images are mirrored to `ghcr.io/silverbulletmd/silverbullet` under the same
tags.

To run one:

```shell
docker run -p 3000:3000 -v <PATH-TO-YOUR-SPACE>:/space zefhemel/silverbullet:v2
```

These are built by `.github/workflows/ci.yml`, which cross-compiles the binary
natively (`cargo build --target` with installed musl cross-toolchains) and copies
it into a small Alpine image.

