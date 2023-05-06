#!/bin/bash -e

VERSION=$1
echo "export const version = '$VERSION';" > version.ts
cd desktop; npm version $VERSION; cd ..
git commit -am $VERSION
git tag $VERSION
git push && git push --tags
