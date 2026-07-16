---
tags: api/space-lua
references:
- client/space_lua/stdlib/js.ts
---

The `js` namespace provides JavaScript interoperability, including dynamic module imports, Lua/JavaScript value conversion, and asynchronous iterable support.

`js.importFromSpace` resolves a space-relative file path to the current space's same-origin `/.fs` URL. This lets a library import a JavaScript module shipped as a [[Frontmatter#files]] asset without constructing a deployment-specific base URL. A leading slash is optional, and a sole `default` export is unwrapped like `js.import`.

${spacelua.renderApiDocumentation("js")}
