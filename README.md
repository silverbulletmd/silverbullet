# SilverBullet
SilverBullet is a note-taking application optimized for people with a [hacker mindset](https://en.wikipedia.org/wiki/Hacker). We all take notes. There’s a million note taking applications out there. [Literally](https://www.noteapps.ca/). Wouldn’t it be nice to have one where your notes are _more_ than plain text files? Where your notes essentially become a _database_ that you can query; that you can build custom knowledge applications on top of? A _hackable notebook_, if you will?

This is what SilverBullet aims to be.

Absolutely. You use SilverBullet to quickly jot things down. It’s a notes app after all. However, this is just the beginning. Gradually, you start to annotate your notes using [Frontmatter](https://silverbullet.md/Frontmatter). You realize: “Hey, this note represents a _person_, let me [tag](https://silverbullet.md/Tags) it as such.” Before you know it, you’re turning your notes into [Objects](https://silverbullet.md/Objects). Then you learn that in SilverBullet you can [Live Query](https://silverbullet.md/Live%20Queries) these objects. Your queries grow into reusable [Templates](https://silverbullet.md/Templates) written using a powerful [Template Language](https://silverbullet.md/Template%20Language). You find more and more uses of these templates, for instance to create [new pages](https://silverbullet.md/Page%20Templates), or [widgets](https://silverbullet.md/Live%20Template%20Widgets) automatically added to your pages.

And then, before you know it — you realize you’re effectively building applications in your notes app. [End-User Programming](https://silverbullet.md/End-User%20Programming), y’all. It’s cool.

You may have been told there is _no such thing_ as a [silver bullet](https://en.wikipedia.org/wiki/Silver_bullet).

You were told wrong.

[![Introduction to SilverBullet](http://img.youtube.com/vi/8btx9HeuZ4s/0.jpg)](https://www.youtube.com/watch?v=8btx9HeuZ4s)

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
Check out the [instructions](https://silverbullet.md/Install).

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
Also be sure to check out our [Discourse community](https://community.silverbullet.md).