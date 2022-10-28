#!/bin/sh

deno run -A --unstable plugos/bin/plugos-bundle.ts $@ --dist dist_bundle/_plug plugs/*/*.plug.yaml
