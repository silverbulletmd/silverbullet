#!/bin/sh

npm run clean-build
rm -rf website_build
mkdir -p website_build/fs/_plug
cp -r packages/web/dist/* website_build/
cp _redirects _headers website_build/
cp -r website/* website_build/fs/
cp packages/plugs/dist/* website_build/fs/_plug/
find website_build/fs/ -depth -name "*.md" -exec sh -c 'mv "$1" "${1%.md}"' _ {} \;
find website_build/fs/ -depth -name "*.plug.json" -exec sh -c 'mv "$1" "${1%.plug.json}"' _ {} \;
node scripts/generate_fs_list.js > website_build/index.json
echo > website_build/empty.md