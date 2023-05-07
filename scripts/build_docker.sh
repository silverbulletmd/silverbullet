#!/bin/sh

deno task compile
docker build -t zefhemel/silverbullet .