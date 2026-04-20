# Vendored runtime libraries

These files are bundled into the configuration-manager plug. They are loaded
into the modal iframe as plain `<script>` text via the plug's asset pipeline,
so they must be IIFE bundles that expose globals — ESM cannot be loaded by the
iframe's `eval(scriptString)` execution path.

No build step touches the plug source code itself; only the vendored runtime
is pre-bundled, once, when bumping the version.

## lit-html.js

Exposes `globalThis.lit` — `{ html, render, nothing, svg, repeat, when, classMap, ref, createRef }`.

To rebuild against the latest `lit-html`, from the repo root:

```sh
make vendor-lit-html
```
