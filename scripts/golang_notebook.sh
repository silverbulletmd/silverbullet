#!/bin/sh

# Runs a "Go" notebook in the current folder for easy Go experimentation

docker run -it --rm -p 8888:8888 -v "${PWD}":/notebooks janpfeifer/gonb_jupyterlab:latest
