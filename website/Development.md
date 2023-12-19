# Stack
SilverBullet is written in [TypeScript](https://www.typescriptlang.org/) and built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor component. Additional UI is built using [Preact](https://preactjs.com/). [ES Build](https://esbuild.github.io) is used to build both the front-end and back-end bundles. The server backend runs as an HTTP server on [Deno](https://deno.land/) using [Oak](https://oakserver.github.io/oak/).

# Development
Requirements: [Deno](https://deno.land/) 1.39 or newer. If you installed [[Install/Deno]] SilverBullet you will already have your toolchain installed. Convenient!

Clone the repository from GitHub:

```shell
git clone git@github.com:silverbulletmd/silverbullet.git
cd silverbullet
```

And build it:

```shell
deno task build
```

For convenience, replace your `silverbullet` install with the one from this repo via:

```shell
deno task install
```

You can now run the server in “watch mode” (automatically restarting when you change source files) with:

```shell
deno task watch-server <PATH-TO-YOUR-SPACE>
```

It's convenient to run three commands in parallel (in separate terminals):

```shell
deno task watch-web
deno task watch-server <PATH-TO-YOUR-SPACE>
deno task watch-plugs
```

All of these watch for file changes and a rebuild should trigger automatically.

Note that there are dependencies between these builds. Any change to any of the built-in _plugs_ requires a rebuild of the web app. Any rebuild of the web app will only be picked up by the server after it restarts (which should happen automatically).