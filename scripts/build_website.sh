#!/bin/sh

npm run clean-build
rm -rf website
mkdir -p website/fs
cp -r packages/web/dist/* website/
cp _redirects website/
cp -r docs/* website/fs/
find website/fs/ -name "*.md" -exec bash -c 'mv "$1" "${1%.md}"' - '{}' +
find website/fs/ -name "*.json" -exec bash -c 'mv "$1" "${1%.json}"' - '{}' +
node scripts/generate_fs_list.js > website/index.json