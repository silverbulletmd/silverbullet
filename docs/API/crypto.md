---
tags: api/space-lua
references:
- client/space_lua/stdlib/crypto.ts
---

The `crypto` namespace computes hash digests.

<!--#lua spacelua.renderApiDocumentation("crypto") -->
## crypto.sha1

`crypto.sha1(data)`

Computes the SHA-1 digest of a string or byte buffer, e.g. to match git object ids. Not for security.

**Parameters:**

- `data` (`string|bytes`) — Data to hash.

**Returns:**

- `string` — Hexadecimal SHA-1 digest.

## crypto.sha256

`crypto.sha256(data)`

Computes the SHA-256 digest of a string or byte buffer.

**Parameters:**

- `data` (`string|bytes`) — Data to hash.

**Returns:**

- `string` — Hexadecimal SHA-256 digest.
<!--/lua-->
