#!/bin/bash

ls | entr -s 'deno run --allow-net --allow-read --allow-write server.ts'