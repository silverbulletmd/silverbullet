## Stack
Silver Bullet is written in [TypeScript](https://www.typescriptlang.org/) and built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor component. Additional UI is built using React.js. [ParcelJS](https://parceljs.org/) is used to build both the front-end and back-end bundles. The server backend runs as a HTTP server on node.js using express.

## Development
This [Silver Bullet repo](https://github.com/zefhemel/silverbullet) is a monorepo using npm's "workspaces" feature.

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

This `<PATH-TO-YOUR-SPACE>` can be any folder with markdown files, upon first boot SB will ensure there is an `index.md` file (root page) and `PLUGS.md` file (with the default list of plugs to load). SB will also create an SQLite `data.db` file with various data caches and indices (you can delete this file at any time and use the `Space: Reindex` command to reindex everything).

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
