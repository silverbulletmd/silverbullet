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

SilverBullet's frontend is written in [TypeScript](https://www.typescriptlang.org/) and built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor component. Additional UI is built using [Preact](https://preactjs.com). [ESBuild]([https://parceljs.org/](https://esbuild.github.io)) is used to build both the front-end.

The server backend is written in Go.

### Requirements
* [Deno](https://deno.com/): Used to build the frontend and plugs
* [Go](https://go.dev/): Used to build the backend

It's convenient to also install [air](https://github.com/air-verse/air) for development, this will automatically rebuild both the frontend and backend when changes are made:

```shell
go install github.com/air-verse/air@latest
```
Make sure your `$GOPATH/bin` is in your $PATH.

To build everything and run the server:

```shell
air <PATH-TO-YOUR-SPACE>
```

Alternatively, to build just the frontend:

```shell
deno task build
```

To build the backend (note: this will bundle the frontend into the same binary, so be sure to build that first):

```shell
go build
```

To run the resulting server:

```shell
./silverbullet <PATH-TO-YOUR-SPACE>
```

### Useful development tasks

Typecheck, lint and test the frontend:

```shell
deno task checks    # Run check, lint, and test together
```

### Build a docker container
Note, you do not need Deno nor Go locally installed for this to work:

```shell
docker build -t silverbullet .
```

To run:

```shell
docker run -p 3000:3000 -v <PATH-TO-YOUR-SPACE>:/space silverbullet
```
