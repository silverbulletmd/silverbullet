---
tags: component
partOf: "[[Architecture/Client]]"
references:
- client/service_registry.ts
- client/plugos/syscalls/service_registry.ts
---
The [[Service|service registry]] discovers implementations by selector, ranks matching handlers, and invokes the selected implementation. It supports extension points such as [[Share]] transports and export formats.
