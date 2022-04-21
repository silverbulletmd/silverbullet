# Silver Bullet

Mono repo using npm workspaces.

To install, after clone:

```shell
# The path for pages, hardcoded for `npm run server`
mkdir -p pages
# Install dependencies
npm install
# Run initial build (web app, server, etc.)
npm run build
# Again, to install the CLIs just built
npm install
# Build plugs (ctrl-c after done, it's watching)
npm run plugs
# Symlink in the default set of plugs into your space
cd pages
ln -s ../packages/plugs/dist _plug
cd ..
# Launch server
npm run server
```

Open at http://localhost:3000

General development workflow:

```shell
# Run these in separate terminals
npm run watch
npm run server
npm run plugs
```
