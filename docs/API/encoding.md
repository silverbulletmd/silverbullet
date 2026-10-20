---
tags: api/space-lua
references:
- client/space_lua/stdlib/encoding.ts
---

The `encoding` namespace converts between strings, byte buffers, Base64, URL percent-encoding, and UTF-8.

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

## encoding.urlDecode

`encoding.urlDecode(encoded)`

Decodes a percent-encoded string, like JavaScript's decodeURIComponent. Malformed input is returned unchanged.

**Parameters:**

- `encoded` (`string`)

**Returns:**

- `string` — Decoded string.

## encoding.urlEncode

`encoding.urlEncode(value)`

Percent-encodes a string as UTF-8, like JavaScript's encodeURIComponent.

**Parameters:**

- `value` (`string`)

**Returns:**

- `string` — URL-encoded string.

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

