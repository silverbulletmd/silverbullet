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
deno task build
deno task bundle
mkdir -p website_build
cp dist/silverbullet.js website_build/
cp install.sh website_build/