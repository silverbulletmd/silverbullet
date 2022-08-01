#!/bin/sh

echo "Building silver bullet"
npm run clean-build
echo "Cleaning website build dir"
rm -rf website_build
mkdir -p website_build/fs/_plug
echo "Copying silverbullet runtime files"
cp -r packages/web/dist/* website_build/
echo "Copying netlify config files"
cp website/{_redirects,_headers} website_build/

echo "Copying website markdown files"
cp -r website/* website_build/fs/
rm website_build/fs/{_redirects,_headers}

echo "Copying standard set of plugs"
cp packages/plugs/dist/* website_build/fs/_plug/

echo "Applying rename magic"
find website_build/fs/ -depth -name "*.md" -exec sh -c 'mv "$1" "${1%.md}"' _ {} \;
find website_build/fs/ -depth -name "*.plug.json" -exec sh -c 'mv "$1" "${1%.plug.json}"' _ {} \;

echo "Generating file listing"
node scripts/generate_fs_list.js > website_build/index.json

echo > website_build/empty.md