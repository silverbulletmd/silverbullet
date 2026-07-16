---
tags: api/syscall
references:
- plug-api/syscalls/datastore.ts
- client/plugos/syscalls/datastore.ts
- client/data/datastore.ts
---

The Datastore API provides functions for interacting with a key-value store that has query capabilities.

* **Keys** are represented as a list (Lua table) of strings.
* **Values** can be any persistable value.

${spacelua.renderApiDocumentation("datastore")}
