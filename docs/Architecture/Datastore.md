---
tags: component
partOf: "[[Architecture/Client]]"
references:
- client/data/datastore.ts
- client/data/object_index.ts
- client/data/kv_primitives.ts
---
An IndexedDB-backed key-value store for the client’s [[Object Index]], [[Sync]] file cache, runtime configuration and internal message queue. Extensions access it through [[API/datastore]].
