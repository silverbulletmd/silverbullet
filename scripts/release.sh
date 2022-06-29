#!/bin/bash -e

VERSION=$1
npm version --ws $VERSION || true
npm install --workspace packages/server --save @silverbulletmd/web@$VERSION @silverbulletmd/common@$VERSION @silverbulletmd/plugs@$VERSION
npm install --workspace packages/plugs --save @silverbulletmd/common@$VERSION

npm run clean-build
npm run publish-all