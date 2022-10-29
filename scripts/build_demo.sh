#!/bin/bash

echo "Install Deno"
# curl -fsSL https://deno.land/install.sh | sh
# export PATH=~/.deno/bin:$PATH

echo "Building silver bullet"
deno task build
echo "Cleaning website build dir"
rm -rf website_build
mkdir -p website_build/fs/_plug
echo "Copying silverbullet runtime files"
cp -r dist_bundle/web/* website_build/
cp -r dist_bundle/_plug/* website_build/fs/_plug/
echo "Copying netlify config files"
cp website/{_redirects,_headers} website_build/

echo "Copying website markdown files"
cp -r website/* website_build/fs/
rm website_build/fs/{_redirects,_headers}

echo "Generating file listing"
deno run -A scripts/generate_fs_list.ts > website_build/index.json

echo > website_build/empty.md

