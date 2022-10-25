#!/bin/sh

deno run -A --unstable silverbullet.ts plug:compile $@ --dist dist_bundle/_plug plugs/*/*.plug.yaml
