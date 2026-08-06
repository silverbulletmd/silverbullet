---
tags: api/space-lua
references:
- client/space_lua/stdlib/net.ts
- plug-api/lib/native_fetch.ts
---

HTTP APIs

> **warning** Warning
> Deprecated: use [[API/net]] instead.

<!--#lua spacelua.renderApiDocumentation("http") -->
## http.request

`http.request(url, options?)`

> **Deprecated:** Use net.proxyFetch instead.

Performs an authenticated HTTP request through the server proxy.

**Parameters:**

- `url` (`string`) — Target URL.
- `options?` (`table`) — Method, headers, body, and response encoding.

**Returns:**

- `table` — Status, headers, and decoded response body.

**See:** [[API/net#net.proxyFetch(url, options?)]]
<!--/lua-->

