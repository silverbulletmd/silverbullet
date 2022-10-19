# Deno SQLite Module

[![test status](https://github.com/dyedgreen/deno-sqlite/workflows/tests/badge.svg?branch=master)](https://github.com/dyedgreen/deno-sqlite/actions)
[![deno doc](https://doc.deno.land/badge.svg)](https://deno.land/x/sqlite/mod.ts)

This is an SQLite module for JavaScript and TypeScript. The wrapper is targeted
at [Deno](https://deno.land) and uses a version of SQLite3 compiled to
WebAssembly (WASM). This module focuses on correctness, ease of use and
performance.

This module guarantees API compatibility according to
[semantic versioning](https://semver.org). Please report any issues you
encounter. Note that the `master` branch might contain new or breaking features.
The versioning guarantee applies only to
[tagged releases](https://github.com/dyedgreen/deno-sqlite/releases).

## Documentation

Documentation is available [Deno Docs](https://deno.land/x/sqlite). There is
also a list of examples in the [`examples`](./examples) folder.

## Example

```javascript
import { DB } from "https://deno.land/x/sqlite/mod.ts";

// Open a database
const db = new DB("test.db");
db.execute(`
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  )
`);

const names = ["Peter Parker", "Clark Kent", "Bruce Wayne"];

// Run a simple query
for (const name of names) {
  db.query("INSERT INTO people (name) VALUES (?)", [name]);
}

// Print out data in table
for (const [name] of db.query("SELECT name FROM people")) {
  console.log(name);
}

// Close connection
db.close();
```

## Comparison to Plugin based Modules

### TL;DR

If you want something that just works (and is fast), use this library.

Depending on your specific needs, there is also
[sqlite3](https://github.com/denodrivers/sqlite3), however using this module
requires the `--allow-ffi` and `--unstable` flags, which means the database
connection may bypass e.g. file access permissions.

### Advantages

- Security: benefit from Denos security settings, without the need to trust a
  third party
- Portability: runs everywhere Deno runs and can even run in the browser
- Ease of Use: takes full advantage of Denos module cache and does not require
  any network access after initial download
- Speed: thanks to WASM, the database performance is comparable to native
  bindings in most situations and the API is carefully designed to provide
  optimal performance

### Disadvantages

- Weaker Persistence Guarantees: due to limitations in Denos file system APIs,
  SQLite can't acquire file locks or memory map files (e.g. this module does not
  support WAL mode)

## Browser Version (Experimental)

There is **experimental** support for using `deno-sqlite` in the browser. You
can generate a browser compatible module by running:

```bash
deno bundle --import-map browser/import_map.json browser/mod.ts [output_bundle_path]
```

The modules documentation can be seen by running

```bash
deno doc browser/mod.ts
```

Databases created in the browser are persisted using
[indexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).

## Users

- [cotton](https://github.com/rahmanfadhil/cotton)
- [deno-nessie](https://github.com/halvardssm/deno-nessie)
- [denodb](https://github.com/eveningkid/denodb)
- [denolib/typeorm](https://github.com/denolib/typeorm)
- [small-orm-sqlite](https://github.com/enimatek-nl/small-orm-sqlite)

_(listed in alphabetical order, please submit a PR if you are using this library
and are not included)_
