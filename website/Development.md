# Stack
SilverBullet’s client is written in [TypeScript](https://www.typescriptlang.org/) and built on top of the excellent [CodeMirror 6](https://codemirror.net/) editor component. Additional UI is built using [Preact](https://preactjs.com/). [ES Build](https://esbuild.github.io) is used to build the frontend.

[[Plugs]] are also written in TypeScript.

The SilverBullet server is written in [Go](https://go.dev/).

# Code structure
* `client/`: The SilverBullet client, implemented with TypeScript
* `server/`: The SilverBullet server, written in Go
* `plugs`: Set of built-in plugs that are distributed with SilverBullet
* `libraries`: A set of libraries (space scripts, page templates, slash templates) distributed with SilverBullet
* `plug-api/`: Useful APIs for use in plugs
  * `lib/`: Useful libraries to be used in plugs
  * `syscalls/`: TypeScript wrappers around syscalls
  * `types/`: Various (client) types that can be references from plugs
* `bin`
  * `plug_compile.ts` the plug compiler
* `scripts/`: Useful scripts
* `website/`: silverbullet.md website content

# Development
Requirements: 
* [Deno](https://deno.land/) 2.4 or newer.
* [Go](https://go.dev/) 1.25 or newer
* Make

It's convenient to also install [air](https://github.com/air-verse/air) for development, this tool will watch your code base for changes and automatically rebuild:

```shell
go install github.com/air-verse/air@latest
```

Make sure your `$GOPATH/bin` is in your $PATH.

To build everything and run the server using air:

```shell
air <PATH-TO-YOUR-SPACE>
```

Note, that if you want to pass arguments to your SilverBullet binary like `-p` or `-L` you need to this as follows:

```shell
air -- -L 0.0.0.0 <PATH-TO-YOUR-SPACE>
```


Alternatively, to build the project without air:

```shell
make build
```

To run the resulting server:

```shell
./silverbullet <PATH-TO-YOUR-SPACE>
```

### Useful development tasks

```shell
# Clean all generated files
make clean
# Typecheck and lint all code
make check
# Format all code
make fmt
# Run all tests
make test
```

### Build a docker container
Note, you do not need Deno nor Go locally installed for this to work:

```shell
docker build -t silverbullet .
```

To run:

```shell
docker run -p 3000:3000 -v <PATH-TO-YOUR-SPACE>:/space silverbullet
```

