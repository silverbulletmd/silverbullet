#!/bin/bash -e

VERSION=$1

# Patch version is version.ts and deno.json
echo "export const version = \"$VERSION\";" > version.ts
sed -i '' "s/\(\"version\": \"\)[^\"]*\(\"\)/\1$VERSION\2/" deno.json
git commit -am $VERSION
git tag $VERSION
git push && git push --tags
