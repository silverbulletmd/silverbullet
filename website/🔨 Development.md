## Stack

Silver Bullet is written in [TypeScript](https://www.typescriptlang.org/) and
built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor
component. Additional UI is built using Preact.
[ES Build](https://esbuild.github.io) is used to build both the front-end and
back-end bundles. The server backend runs as a HTTP server on Deno using Oak.

## Development

Requirements: [Deno](https://deno.land/) 1.26.

To run, after clone:

```shell
deno task install
```

To prepare the initial web and plug build run:

```shell
deno task build
```

You can then run the server in “watch mode” (automatically restarting when you
change source files) with:

```shell
deno task watch-server -- <PATH-TO-YOUR-SPACE>
```

After this initial build, it's convenient to run three commands in parallel (in
separate terminals):

```shell
deno task watch-web
deno task watch-server -- <PATH-TO-YOUR-SPACE>
deno task watch-plugs
```
