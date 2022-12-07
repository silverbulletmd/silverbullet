#!/bin/sh

deno task bundle
docker build -t zefhemel/silverbullet .