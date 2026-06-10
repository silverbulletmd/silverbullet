So you're interested in helping out? That's great!

## Issuing PRs
Before issuing a PR, please run a few commands:

```bash
# Compile the service
npm install
make build
# Run all tests
make test
# Reformat all code
make fmt
```

This ensures that the basics work.

You will need node and go to perform the build and tests. Alternatively you can compile it in a Docker container:
````bash
docker run -it --rm \
  -v "$PWD":/workdir \
  -w /workdir \
  bitnami/minideb bash
install_packages golang nodejs npm make
npm install
make build
```
