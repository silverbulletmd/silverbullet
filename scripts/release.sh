#!/bin/bash -e

VERSION=$1
npm version --ws $VERSION || true
npm install --ws server --save @silverbulletmd/web@$VERSION @silverbulletmd/plugs@$VERSION @silverbulletmd/common@$VERSION
npm run clean-build
npm run publish-all