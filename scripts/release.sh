#!/bin/bash -e

VERSION=$1

# Patch version in version.ts
echo "export const version = \"$VERSION\";" > version.ts
# Patch version in package.json
npm version --no-git-tag-version --allow-same-version "$VERSION"
git commit -am $VERSION
git tag $VERSION
git push && git push --tags
