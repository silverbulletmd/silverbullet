#!/bin/sh

deno run -A --unstable silverbullet.ts plug:build $@ --dist dist_bundle/_plug plugs/*/*.plug.yaml
