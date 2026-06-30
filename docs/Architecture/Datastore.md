---
tags: component
partOf: "[[Architecture/Client]]"
references:
- client/data/datastore.ts
- client/data/object_index.ts
- client/data/kv_primitives.ts
---
An IndexedDB-backed key-value store — the client's local persistence layer. It holds the [[Object Index]] (enabling fast local [[Space Lua/Integrated Query|queries]]), the [[Sync]] file cache, runtime configuration, and the internal message queue. Wraps low-level KV primitives; exposed to extensions via [[API/datastore]].
