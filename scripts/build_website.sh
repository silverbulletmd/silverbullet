#!/bin/bash -e

if [ "$1" != "local" ]; then
    echo "Install Deno"
    curl -fsSL https://deno.land/install.sh | sh
    export PATH=~/.deno/bin:$PATH
    export DENO_DIR=$PWD/deno_cache
    echo "DENO_DIR: $DENO_DIR"
    mkdir -p $DENO_DIR

    echo "Generating version number..."
    echo "export const version = '$(git rev-parse HEAD)';" > version.ts
fi

echo "Building silver bullet"
rm -rf website_build
deno task clean
deno task build
echo "Cleaning website build dir"
rm -rf website_build
mkdir -p website_build/fs/_plug
echo "Copying silverbullet runtime files"
cp -r dist_client_bundle/* website_build/

echo "And all plugs"
cp -r dist_plug_bundle/_plug/* website_build/fs/_plug/
#echo "And additional ones"
curl https://raw.githubusercontent.com/silverbulletmd/silverbullet-mermaid/main/mermaid.plug.js > website_build/fs/_plug/mermaid.plug.js
echo "But remove some plugs"
rm -rf website_build/fs/_plug/{plugmd}.plug.js
echo "Copying netlify config files"
cp website/{_redirects,_headers} website_build/

echo "Copying website content into fs/"
cp -r website/* website_build/fs/
rm website_build/fs/{_redirects,_headers}

echo "Copy website files another time into the root"
cp -r website/* website_build/

#echo "Generating file listing"
deno run -A scripts/generate_fs_list.ts > website_build/index.json

echo > website_build/empty.md

#echo "Bundling..."
deno task bundle
cp dist/silverbullet.js website_build/
cp web/images/logo.ico website_build/