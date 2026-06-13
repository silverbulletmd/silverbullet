![GitHub Repo stars](https://img.shields.io/github/stars/silverbulletmd/silverbullet)
![Docker Pulls](https://img.shields.io/docker/pulls/zefhemel/silverbullet)
![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/silverbulletmd/silverbullet/total)
![GitHub contributors](https://img.shields.io/github/contributors/silverbulletmd/silverbullet)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/silverbulletmd/silverbullet)

# SilverBullet
SilverBullet is a Programmable, Private, Browser-based, Open Source, Self Hosted, Personal Knowledge Database — a fancy term for a "notes app on steroids".

_Yowza!_ That surely is a lot of adjectives to describe a browser-based Markdown editor programmable with Lua.

Let’s get more specific.

SilverBullet combines a clean live-preview editor with wiki-style linking, a built-in database and query language, and a fully integrated Space Lua scripting environment, turning your notes into a programmable system that grows with you.

In SilverBullet you keep your content as a collection of Markdown Pages (called a Space). You navigate your space using the Page Picker like a traditional notes app, or through Links like a wiki (except they are bi-directional).

If you are the **writer** type, you’ll appreciate SilverBullet as a clean Markdown editor with Live Preview. If you have more of an **outliner** personality, SilverBullet has Outlining tools for you. Productivity freak? Have a look at Tasks. More of a **database** person? You will appreciate Objects and Queries (SLIQ). 

And if you are comfortable **programming** a little bit — now we’re really talking. You will love _dynamically generating content_ with Space Lua (SilverBullet’s Lua dialect), or to use it to create custom Commands, Page Templates or Widgets.

You were told there’s no such thing as a silver bullet. You were told wrong.

[Much more detail can be found on silverbullet.md](https://silverbullet.md)

## Installing SilverBullet
Check out the [instructions](https://silverbullet.md/Install).

## Developing SilverBullet
SilverBullet's frontend ("client") is written in [TypeScript](https://www.typescriptlang.org/) and built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor component. Additional UI is built using [Preact](https://preactjs.com). [ESBuild](https://esbuild.github.io) is used to build the frontend.

The server backend is written in [Rust](https://www.rust-lang.org/) (a Cargo workspace). It serves the pre-built client bundle, the file/space HTTP API, authentication, and a headless-Chrome runtime for server-side Lua.

## Code structure
* `bin/silverbullet/`: The standalone `silverbullet` server binary (Rust) (this is the one you generally run)
* `bin/sb/`: The `sb` CLI client (Rust)
* `bin/plug-compile.ts`: the plug compiler
* `client/`: The SilverBullet client (browser, TypeScript)
* `server/`: The SilverBullet server library (Rust): HTTP router, handlers, auth, runtime seam
* `server-common/`: Shared Rust crate (space primitives, shared types)
* `server-runtime-chrome/`: Headless-Chrome runtime backend (Rust)
* `plugs`: Set of built-in plugs (TypeScript) that are distributed with SilverBullet
* `libraries`: A set of libraries (space scripts, page templates, slash templates) distributed with SilverBullet (Space Lua)
* `plug-api/`: Useful APIs for use in plugs and published to NPM
  * `lib/`: Useful libraries to be used in plugs
  * `syscalls/`: TypeScript wrappers around syscalls
  * `types/`: Various (client) types that can be references from plugs
* `scripts/`: Useful scripts
* `website/`: silverbullet.md website content

### Requirements
* [Node.js](https://nodejs.org/) 24+ and npm 10+: Used to build the frontend (client) and plugs
* [Rust](https://www.rust-lang.org/tools/install) (stable, via `rustup`): Used to build the server

The project includes `.nvmrc` and `.node-version` files. If you use [nvm](https://github.com/nvm-sh/nvm) or another Node version manager, it will automatically use the correct Node.js version:

```shell
nvm use  # If using nvm
```

First, install dependencies:

```shell
make setup
```

To create a (release) build:

```shell
make
```

This will produce `silverbullet` and `cli` binaries in `./target/release/`, run `./target/release/silverbullet` to run the server.

### Development workflow

SilverBullet has two halves you rebuild **independently**:

* The **client** (TypeScript: `client/`) is built by ESBuild into `client_bundle/`, which the server then serves.
* The **server** (Rust: `server/`, `server-common/`, `server-runtime-chrome/`, `bin/silverbullet/`) is a compiled binary.

Run the server in development with `cargo run`. A **debug** build serves the client bundle **live from `client_bundle/` on disk** (a release build embeds it instead):

```shell
cargo run <PATH-TO-YOUR-SPACE>
```

**When you change only the client** (TypeScript in `client/`): you do **not** need to restart the server. Rebuild just the client bundle and reload the page in your browser — the debug server serves the freshly-built bundle straight from disk:

```shell
npm run build
```

To build a self-contained **release** binary (with the client bundle embedded), and run it:

```shell
make
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
# Run benchmarks
make bench
```

### Build a docker container
Note, you do not need Node.js nor Go locally installed for this to work:

```shell
docker build -t silverbullet .
```

To run:
```shell
docker run -p 3000:3000 -v <PATH-TO-YOUR-SPACE>:/space silverbullet
```
