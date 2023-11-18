# SilverBullet
SilverBullet aims to be your **workshop for the mind**: a creative space where you collect, create and expand your personal knowledge, while also letting you constantly evolve the tools you use to do so.

While you _can_ use SilverBullet as a simple note taking application that stores notes in plain markdown files on disk, it becomes truly powerful in the hands of more technical power users. By leveraging metadata annotations, its Objects infrastructure, Live Queries and Live Templates, SilverBullet becomes a powerful _end-user programming tool_, enabling you to quickly develop various types of ad-hoc knowledge applications.

SilverBullet is implemented as an open-source, self-hosted, offline-capable web application.

You’ve been told there is _no such thing_ as a [silver bullet](https://en.wikipedia.org/wiki/Silver_bullet). You were told wrong.

[![IIntroduction to SilverBullet](http://img.youtube.com/vi/BbNbZgOwB-Y/0.jpg)](http://www.youtube.com/watch?v=BbNbZgOwB-Y)

## Features
SilverBullet...
* Runs in any modern browser (including on mobile) as a PWA in two Client Modes (_online_ and _synced_ mode), where the _synced mode_ enables **100% offline operation**, keeping a copy of content in the browser, syncing back to the server when a network connection is available.
* Provides an enjoyable markdown writing experience with a clean UI, rendering text using Live Preview, further **reducing visual noise** while still providing direct access to the underlying markdown syntax.
* Supports wiki-style **page linking** using the `[[page link]]` syntax. Incoming links are indexed and appear as “Linked Mentions” at the bottom of the pages linked to thereby providing _bi-directional linking_.
* Optimized for **keyboard-based operation**:
  * Quickly navigate between pages using the **page switcher** (triggered with `Cmd-k` on Mac or `Ctrl-k` on Linux and Windows).
  * Run commands via their keyboard shortcuts or the **command palette** (triggered with `Cmd-/` or `Ctrl-/` on Linux and Windows).
  * Use Slash Commands to perform common text editing operations.
* Provides a platform for [end-user programming](https://www.inkandswitch.com/end-user-programming/) through its support for Objects, Live Queries and Live Templates.
* Robust extension mechanism using plugs.
* **Self-hosted**: you own your data. All content is stored as plain files in a folder on disk. Back up, sync, edit, publish, script with any additional tools you like.
* SilverBullet is [open source, MIT licensed](https://github.com/silverbulletmd/silverbullet) software.


## Installing SilverBullet
Check out the [official website](https://silverbullet.md)

## Developing SilverBullet

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/#https://github.com/silverbulletmd/silverbullet)

SilverBullet is written in [TypeScript](https://www.typescriptlang.org/) and
built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor
component. Additional UI is built using [Preact](https://preactjs.com).
[ESBuild]([https://parceljs.org/](https://esbuild.github.io)) is used to build both the front-end and
back-end bundles. The server backend runs as a HTTP server on Deno using and is written using [Oak](https://oakserver.github.io/oak/).

To prepare the initial web and plug build run:

```shell
deno task build
```

To symlink `silverbullet` to your locally checked-out version, run:

```shell
deno task install
```

You can then run the server in “watch mode” (automatically restarting when you
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

To typecheck the entire codebase (recommended before submitting PR):
```shell
deno task check
```

To run unit tests:
```shell
deno task test
```
## Feedback

If you (hypothetically) find bugs or have feature requests, post them in
[our issue tracker](https://github.com/silverbulletmd/silverbullet/issues).
Would you like to contribute?
[Check out the code](https://github.com/silverbulletmd/silverbullet), and the
issue tracker as well for ideas on what to work on.
