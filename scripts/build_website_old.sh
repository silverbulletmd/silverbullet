#!/bin/bash


echo "Now building SilverBullet bundle"
curl -fsSL https://deno.land/install.sh | sh
export PATH=~/.deno/bin:$PATH

echo "Generating version number..."
echo "export const version = '$(git rev-parse HEAD)';" > version.ts
echo "Building..."
deno task build
deno task install

rm -rf website_build
silverbullet publish --index -o website_build website

echo "Bundling..."
deno task bundle
cp dist/silverbullet.js website_build/
