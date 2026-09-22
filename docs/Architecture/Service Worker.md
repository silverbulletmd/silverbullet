---
tags: component
connectsTo:
- "[[Architecture/Server]]"
references:
- client/service_worker.ts
- client/service_worker/proxy_router.ts
- client/service_worker/byte_range.ts
- client/service_worker/sync_engine.ts
---
One instance per browser. The [service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) makes SilverBullet offline-capable: it caches and serves the client code, embeds the [[Sync]] engine that keeps a local copy of your files, and implements the [[HTTP API]] locally by intercepting calls bound for the [[Architecture/Server]].

By default, `sync.documents` is disabled, so non-Markdown documents are not copied into IndexedDB. A `/.fs` request for such a document misses local storage and is proxied with the original request object. During initial sync, a document already present locally may use the local fast path instead.

When `sync.documents` is enabled and a document exists locally, IndexedDB still stores and returns the complete value.
