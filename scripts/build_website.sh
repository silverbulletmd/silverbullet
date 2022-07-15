#!/bin/sh

npm run clean-build
rm -rf website
mkdir -p website/fs
cp -r packages/web/dist/* website/
cp _redirects website/
cp -r docs/* website/fs/
node scripts/generate_fs_list.js > website/fs/index.json