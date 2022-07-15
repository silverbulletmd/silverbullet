#!/bin/sh

npm run clean-build
rm -rf website
mkdir -p website/fs
cp -r packages/web/dist/* website/
cp -r docs/* website/fs/