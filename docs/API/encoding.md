---
tags: api/space-lua
references:
- client/space_lua/stdlib/encoding.ts
---

The `encoding` namespace converts between strings, byte buffers, Base64, and UTF-8.

<!--#lua spacelua.renderApiDocumentation("encoding") -->
## encoding.base64Decode

`encoding.base64Decode(encoded)`

Decodes a Base64 string into a byte buffer.

**Parameters:**

- `encoded` (`string`)

**Returns:**

- `bytes` — Decoded bytes.

## encoding.base64Encode

`encoding.base64Encode(data)`

Encodes a string or byte buffer as Base64.

**Parameters:**

- `data` (`string|bytes`)

**Returns:**

- `string` — Base64-encoded data.

## encoding.utf8Decode

`encoding.utf8Decode(data)`

Decodes a UTF-8 byte buffer into a string.

**Parameters:**

- `data` (`bytes`)

**Returns:**

- `string` — Decoded text.

## encoding.utf8Encode

`encoding.utf8Encode(value)`

Encodes a UTF-8 string into a byte buffer.

**Parameters:**

- `value` (`string`)

**Returns:**

- `bytes` — UTF-8 encoded bytes.
<!--/lua-->

