# Silver Bullet
Silver Bullet (SB) is an extensible, open source **personal knowledge platform**. At its core it’s a clean markdown-based writing/note taking application that stores your _pages_ (notes) as plain markdown files in a folder referred to as a _space_. Pages can be cross-linked using the `[[link to other page]]` syntax. This makes it a simple tool for [Personal Knowledge Management](https://en.wikipedia.org/wiki/Personal_knowledge_management). However, once you leverage its various extensions (called _plugs_) it can feel more like a _knowledge platform_, allowing you to annotate, combine and query your accumulated knowledge in creative ways specific to you.

<img src="https://github.com/silverbulletmd/silverbullet/raw/main/images/silverbullet-pwa.png" height="400"/><img src="https://github.com/silverbulletmd/silverbullet/raw/main/images/silverbullet-ios.png" height="400"/>

For more in-depth information, an interactive demo, and links to more background, check out the [Silver Bullet website](https://silverbullet.md) (published from this repo’s `website/` folder).

Or checkout these two videos:

* [A Tour of some of Silver Bullet’s features](https://youtu.be/RYdc3UF9gok) — spoiler alert: it’s cool.
* [A look the SilverBullet architecture](https://youtu.be/mXCGau05p5o) — spoiler alert: it’s plugs all the way down.

## Features
* **Free and open source**. Silver Bullet is MIT licensed.
* **The truth is in the markdown.** Silver Bullet doesn’t use proprietary file formats. It keeps its data as plain markdown files on disk. While SB uses a database for indexing and caching some indexes, all of that can be rebuilt from its markdown source at any time. If SB would ever go away, you can still read your pages with any text editor.
* **One single, distraction free mode.** SB doesn’t have a separate view and edit mode. It doesn’t have a “focus mode.” You’re always in focused edit mode, why wouldn’t you?
* **Keyboard oriented**. You can use SB fully using the keyboard, typin’ the keys.
* **Extend it your way**. SB is highly extensible with [plugs](https://silverbullet.md/🔌_Plugs), and you can customize it to your liking and your workflows.

## Installing Silver Bullet
To install Silver Bullet, you will need a recent version of [node.js installed](https://nodejs.org/en/) (16+) installed. Silver Bullet has only been tested on MacOS and Linux thus far. It may run on Windows as well, let me know if it does.

To install and run SB, create a folder for your pages (it can be empty, or be an existing folder with `.md` files) and run the following command in your terminal:

    npx @silverbulletmd/server <path-to-folder>

This will do one of three things:

1. If you _don’t have_ SB installed, it will download and run the latest version.
2. If you _already have_ SB installed, but there is a newer version available, it will offer to upgrade. Say yes!
3. If you _already have the latest and greatest_ SB installed, it will just run it.

By default, SB will bind to port `3000`, to use a different port use the `--port` flag. By default SB doesn’t offer any sort of authentication, to add basic password authentication, pass the `--password` flag.

Once downloaded and booted, SB will print out a URL to open SB in your browser (spoiler alert: by default this will be http://localhost:3000 ).

#protip: If you have a PWA enabled browser (like any browser based on Chromium) hit that little button right of the location bar to install SB, and give it its own window frame (sans location bar) and desktop/dock icon. At last the PWA has found its killer app.

## Developing Silver Bullet

[![Open in Gitpod](https://gitpod.io/button/open-in-gitpod.svg)](https://gitpod.io/#https://github.com/silverbulletmd/silverbullet)

Silver Bullet is written in [TypeScript](https://www.typescriptlang.org/) and built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor component. Additional UI is built using React.js. [ParcelJS](https://parceljs.org/) is used to build both the front-end and back-end bundles. The server backend runs as a HTTP server on node.js using express.

This repo is a monorepo using npm's "workspaces" feature. It consists of a number of npm packages under `packages`.

Requirements: node 16+ and npm 8+ as well as C/C++ compilers (for compiling SQLite, on debian/ubuntu style systems you get these via the `build-essential` package).

After cloning the repo, run the following commands to do an initial build:

```shell
npm install
npm run clean-build
```

You can then run the server in “watch mode” (automatically restarting when you change source files) with:

```shell
npm run server -- <PATH-TO-YOUR-SPACE>
```

`<PATH-TO-YOUR-SPACE>` can be any folder with markdown files (or an empty folder).

After this initial build, I generally run three commands in parallel (in separate terminals):

```shell
# Runs ParcelJS in watch mode, rebuilding the server and webapp continuously on change
npm run watch
# Runs the silverbullet server, restarting when changes are detected
npm run server -- <PATH-TO-YOUR-SPACE>
# Builds (and watches for changes) all builtin plugs (in packages/plugs), still requires you to run Cmd-Shift-p (Mac) or Ctrl-Shift-p (Linux, Windows) in SB to reload these plugs
npm run plugs
```


## Feedback
If you (hypothetically) find bugs or have feature requests, post them in [our issue tracker](https://github.com/silverbulletmd/silverbullet/issues). Would you like to contribute? [Check out the code](https://github.com/silverbulletmd/silverbullet), and the issue tracker as well for ideas on what to work on.

