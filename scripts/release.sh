#!/bin/bash -e

VERSION=$1
echo "export const version = \"$VERSION\";" > version.ts
git commit -am $VERSION
git tag $VERSION
git push && git push --tags
