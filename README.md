# SilverBullet
SilverBullet is an open source **personal productivity platform** built on Markdown, turbo charged with the scripting power of Lua. You self host it on your server, access it via any modern browser on any device (desktop, laptop, mobile). Since SilverBullet is built as a Local First PWA, it is fully offline capable. Temporarily don't have network access? No problem, SilverBullet will sync your content when you get back online.

You may start your SilverBullet journey by simply thinking of it as a note taking app. Because, well, it is. You write notes in Markdown and get Live Preview. It looks WYSIWYG while still easily accessing the markdown that lies underneath. You can create Links to other pages, via the `[[other page]]` syntax. As you navigate your Space (that's what we call a SilverBullet instance) by clicking these links, you will see Linked Mentions to get a feel of how your pages are inter-linked.

Then you learn that in SilverBullet, you can embed Space Lua (SilverBullet's Lua dialect) right into your pages, using the special `${lua expression}` syntax. You try something simple, like `${10 + 2}`. Ok, that's cool. As you learn more, you start tagging pages and adding Frontmatter. As it turns out, pages (and other things) are indexed as Objects. You realize you can query these objects like a database.

Imagine the possibilities. Before you know it — you realize you're effectively building applications in your notes app. End-User Programming, y'all. It's cool.

You may have been told there is _no such thing_ as a [silver bullet](https://en.wikipedia.org/wiki/Silver_bullet).

You were told wrong.

[![Introduction to SilverBullet](http://img.youtube.com/vi/mik1EbTshX4/0.jpg)](https://www.youtube.com/watch?v=mik1EbTshX4)

## Features
SilverBullet...
* At its core is a **note taking** application, a kind of personal wiki, storing its notes in the universal Markdown format in a folder on your server.
* Is a **web application** and therefore accessible from wherever a (modern) web browser is available.
* Is built as a Local First PWA keeping a copy of your content in your browser's local database, syncing back to the server when a network connection is available, enabling **100% offline operation**.
* Provides an enjoyable Markdown writing experience with a clean UI, rendering text using Live Preview, further **reducing visual noise** while still providing direct access to the underlying markdown syntax.
* Supports wiki-style **page linking** using the `[[page link]]` syntax. Incoming links are indexed and appear as Linked Mentions at the bottom of the pages linked to thereby providing _bi-directional linking_.
* Is optimized for **keyboard-based operation**:
  * Quickly navigate between pages using the **page switcher** (triggered with `Cmd-k` on Mac or `Ctrl-k` on Linux and Windows).
  * Run commands via their keyboard shortcuts or the **command palette** (triggered with `Cmd-/` or `Ctrl-/` on Linux and Windows).
  * Use Slash Commands to perform common text editing operations.
* Is a platform for End-User Programming through its support for Objects and Space Lua.
* Can be extended using Space Lua and Plugs, and a lot of core functionality is built that way.
* Is **self-hosted**: _you own your data_. Your space is stored as plain files in a folder on disk on your server. Back it up, sync, edit, publish, script it with any additional tools you like.
* Is free, [**open source**, MIT licensed](https://github.com/silverbulletmd/silverbullet) software.

## Installing SilverBullet
Check out the [instructions](https://silverbullet.md/Install).

## Developing SilverBullet

SilverBullet is written in [TypeScript](https://www.typescriptlang.org/) and
built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor
component. Additional UI is built using [Preact](https://preactjs.com).
[ESBuild]([https://parceljs.org/](https://esbuild.github.io)) is used to build both the front-end and
back-end bundles. The server backend runs as a HTTP server on Deno using and is written using [Hono](https://hono.dev).

To prepare the initial web and plug build run:

```shell
deno task build
```

To symlink `silverbullet` to your locally checked-out version, run:

```shell
deno task install
```

You can then run the server in "watch mode" (automatically restarting when you
change source files) with:

```shell
deno task watch-server <PATH-TO-YOUR-SPACE>
```

After this initial build, it's convenient to run three commands in parallel (in
separate terminals):

```shell
deno task watch-web
deno task watch-server <PATH-TO-YOUR-SPACE>
deno task watch-plugs
```

Alternatively, you can use the convenience task (though you'll need to set the server path in a separate terminal first):

```shell
deno task watch-all
```

To typecheck the entire codebase (recommended before submitting PR):
```shell
deno task check
```

Other useful development tasks:
```shell
deno task lint      # Lint and fix code
deno task fmt       # Format code
deno task test      # Run tests
deno task checks    # Run check, lint, and test together
```

To build it in a docker container (no Deno install required):

```shell
docker build -t silverbullet .
```

To run:

```shell
docker run -p 3000:3000 -v <PATH-TO-YOUR-SPACE>:/space silverbullet
```
