#!/bin/sh

echo "Building both AMD64 and ARM64 Linux binaries"
deno task server:dist:linux-x86_64 && mv silverbullet silverbullet-amd64
deno task server:dist:linux-aarch64 && mv silverbullet silverbullet-arm64
docker build -t silverbullet .