#!/bin/bash -e

VERSION=$1

# Patch version in version.ts
echo "export const version = \"$VERSION\";" > version.ts
git commit -am $VERSION
git tag $VERSION
git push && git push --tags
