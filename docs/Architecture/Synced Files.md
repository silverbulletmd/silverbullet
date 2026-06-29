---
tags: component
partOf: "[[Architecture/Service Worker]]"
references:
- client/spaces/sync.ts
- client/service_worker/sync_engine.ts
- plugs/sync/sync.ts
---
The local (IndexedDB) copy of all [[Space]] files the [[Sync]] engine keeps in step with the [[Architecture/Server]], enabling offline access.
