# Contribute to SQLite for Deno

> Note: this is a draft

Thank you for considering to contribute to the SQLite for Deno module! Below are
a few guidelines on how to contribute.

## Prerequisites

To work on the JavaScript/ TypeScript wrapper module, all you need is a
[deno](https://deno.land) runtime.

To change the compiled SQLite WASM binary, you will require to download the
[WASI SDK][wasi-sdk]. This process should function fully automatically for most
users.

**To install build dependencies** go to the `build` folder (`cd build`), then
run `make setup`.

**To compile the binary** run `make release` (or `make debug` for a debug
build). If you changed any build flags of SQLite, also run `make amalgamation`,
before building.

If you are interested in more details regarding the compilation setup, also see
[this blog post][compile-wasm-blog].

## Code Style, Review, and Dependencies

This project uses the `deno fmt` code style.

This project uses no external dependencies (with the exception of a copy of the
SQLite C library).

For testing purposes, Deno standard library modules may be used.

## Documentation

Any user-facing interfaces should be documented. To document such interfaces,
include a **JSDoc comment**, which should be formatted as follows:

```javascript
/**
 * A short but complete description, formatted
 * as markdown.
 */
functionName(arg1, arg2) {
  // ...
}
```

Comments with this format will be automatically parsed by `deno doc`.

These comments should not include examples unless they are essential to
illustrating an important point.

## Tests and Benchmarks

Any important functionality should be tested. Tests are in the `test.ts` file.
Changes will not be merged unless all tests pass.

Benchmarks are in the `bench.ts` file.

## Technical Direction

The goal of this module is to provide a **simple and predictable** interface to
SQLite. The interface should feel like a JavaScript library, but also
immediately make sense to someone who knows the SQLite C/C++ interface. Features
and interfaces should generally be orthogonal.

This is a low-level library, which provides access to running SQL queries and
retrieving the results of these queries. This library will only wrap SQLite C
API functions, but never try to provide a higher level interface to the database
than plain SQL. It is meant to serve as a building block for constructing higher
level interfaces, or for people who need an easy way to execute SQL queries on
their SQLite database.

The library should be easy to use and behave as any regular JavaScript library
would in Deno. This means, it should only need the required permissions (e.g. if
only in-memory databases are used, no permissions should be necessary. If a
database is opened in read-only mode, `--allow-read` should be sufficient).

## License

By making contributions, you agree that anything you submit will be distributed
under the projects license (see `LICENSE`).

[wasi-sdk]: https://github.com/CraneStation/wasi-sdk/releases
[compile-wasm-blog]: https://tilman.xyz/blog/2019/12/building-webassembly-for-deno/
