# Silver Bullet
Silver Bullet (SB) is a highly extensible, open source **personal knowledge playground**. At its core it’s effectively a Markdown-based writing/note taking application that stores your _pages_ (notes) as plain markdown files in a folder referred to as a _space_. Pages can be cross-linked using the `[[link to other page]]` syntax. This makes it a simple tool for [Personal Knowledge Management](https://en.wikipedia.org/wiki/Personal_knowledge_management). However, once you leverage its various extensions (called _plugs_) it can feel more like a _knowledge playground_, allowing you to annotate, combine and query your accumulated knowledge in creative ways specific to you.

So what is it SB _really_? That is hard to answer. It can do tons of stuff, and I’m constantly finding new use cases. It’s like… a silver bullet.

Here’s how I use it today (but this has grown significantly over time):

* Basic note taking, e.g. during meetings, about books I read, blogs I read, podcasts I listen to, movies I watch.
* Getting a quick glance of the work people in my team are doing pulling data from our 1:1s, recent activity on Github (such as recent pull requests) and other sources.
* Writing:
  * [My blog](https://zef.plus) is published via SB’s [Ghost](https://ghost.org) plugin.
  * An internal newsletter that I write is written in SB.
  * Performance reviews for my team (I work as a people manager) are written and managed using SB (for which I extensively use SB’s meta data features and query that data in various ways).
* A custom SB plugin aggregates data from our OpsGenie account every week, and publishes it to our mattermost instance.
* It powers part of my smart home: I wired HomeBridge webhooks up to custom HTTP endpoints exposed by my custom smart home SB plug.

More documentation can be found in the [docs space](https://github.com/zefhemel/silverbullet/tree/main/docs)

## Features
* **Free and open source**
* **Minimalistic** UI with [What You See is What You Mean](https://en.wikipedia.org/wiki/WYSIWYM) Markdown editing.
* **Future proof**: stores all notes in a regular folder with markdown files, no proprietary file formats. While SB uses a SQLite database for indexes, this database can be wiped and rebuilt based on your pages at any time. Your Markdown files are the single source of truth.
* **Run anywhere**: run it on your local machine, or install it on a server. You access it via your web browser (desktop or mobile), or install it as a PWA (giving it its own window frame and dock/launcher/dock icon).
* **Keyboard oriented:** you can fully operate SB via the keyboard.
* **Extensible** through plugs.
## Stack
* Written in [TypeScript](https://www.typescriptlang.org/)
* Built on the excellent [CodeMirror 6](https://codemirror.net/) editor component
* Front-end (beside CodeMirror) is built using React.js
* [ParcelJS](https://parceljs.org/) is used to build both the front-end and back-end
* Backend runs on node.js using express
## Development
This Silver Bullet repo is a monorepo using npm's "workspaces" feature.

Requirements: node 16+ and npm 8+ as well as C/C++ compilers (for compiling SQLite, on debian/ubuntu style systems you get these via the `build-essential` package)

To run, after clone:

```shell
# Install dependencies
npm install
# Run initial build (web app, server, etc.)
npm run build
# Again, to install the CLIs just built (plugos-bundler, silverbullet)
npm install
# Build built-in plugs
npm run build-plugs
# Launch server
npm run server -- <PATH-TO-YOUR-SPACE>
```

This `<PATH-TO-YOUR-SPACE>` can be any folder with markdown files, upon first boot SB will ensure there is an `index.md` file (root page) and `PLUGS.md` file (with default list of plugs to load). SB will also create a SQLite `data.db` file with various data caches and indices (you can delete this file at any time and use the `Space: Reindex` command to reindex everything).

Open SB at http://localhost:3000 If you're using a browser supporting PWAs, you can install this page as a PWA. This also works on iOS (use the "Add to homescreen" option in the share menu).

General development workflow:

Run these in separate terminals
```shell
# Runs ParcelJS in watch mode, rebuilding the server and webapp continuously on change
npm run watch
# Runs the silverbullet server
npm run server
# Builds (and watches for changes) all builtin plugs (in packages/plugs)
npm run plugs
```
