---
tags: api/space-lua
references:
- client/space_lua/stdlib/net.ts
---

The `net` namespace provides network and URI access.

## Proxy request behavior

`net.proxyFetch` sends HTTP requests through the SilverBullet server to avoid browser CORS restrictions; see [[HTTP API]]. Its options table supports `method` (GET by default), `headers`, `body`, and `responseEncoding`. A table body is JSON-encoded automatically.

The response table contains `ok`, `status`, `headers`, and `body`. JSON responses are parsed into Lua-compatible values, text and XML responses become strings, other content becomes a byte buffer, and an empty body becomes `nil`.

## URI services

`net.readURI` and `net.writeURI` dispatch to the best service registered for the URI. Pass `{encoding = "text/markdown"}` to `net.readURI` when a service should force a particular result encoding.

${spacelua.renderApiDocumentation("net")}
