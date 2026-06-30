---
tags: component
connectsTo:
- "[[Architecture/Server]]"
references:
- client/service_worker.ts
- client/service_worker/proxy_router.ts
- client/service_worker/sync_engine.ts
---
One instance per browser. The [service worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) makes SilverBullet offline-capable: it caches and serves the client code, embeds the [[Sync]] engine that keeps a local copy of your files, and implements the [[HTTP API]] locally by intercepting calls bound for the [[Architecture/Server]].
