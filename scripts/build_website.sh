#!/bin/bash -e

if [ "$1" != "local" ]; then
    echo "Install Deno"
    curl -fsSL https://deno.land/install.sh | sh
    export PATH=~/.deno/bin:$PATH
    export DENO_DIR=$PWD/deno_cache
    echo "DENO_DIR: $DENO_DIR"
    mkdir -p $DENO_DIR

fi

deno task clean
mkdir -p website_build/_plug website_build/_client

echo "Copying website content"
cp -r website/* website_build/
#rm website_build/{_redirects,_headers}

echo "Building silver bullet"
deno task build

echo "Copying silverbullet runtime files"
cp dist_client_bundle/* website_build/
cp -r dist_client_bundle/.client/* website_build/_client/

echo "And all plugs"
cp -r dist_plug_bundle/_plug/* website_build/_plug/
#echo "And additional ones"
curl https://raw.githubusercontent.com/silverbulletmd/silverbullet-mermaid/main/mermaid.plug.js > website_build/_plug/mermaid.plug.js
echo "But remove some plugs"
rm -rf website_build/_plug/{plugmd}.plug.js


# Generate random modified date, and replace in _headers too
export LAST_MODIFIED_TIMESTAMP=$(date +%s000)

cat website/_headers | sed "s/12345/$LAST_MODIFIED_TIMESTAMP/g" > website_build/_headers
echo "Generating file listing"
deno run -A scripts/generate_fs_list.ts > website_build/index.json


#echo "Bundling..."
deno task bundle
cp dist/silverbullet.js website_build/
cp web/images/logo.ico website_build/
cp install.sh website_build/