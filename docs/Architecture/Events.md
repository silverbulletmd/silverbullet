---
tags: component
partOf: "[[Architecture/Client]]"
references:
- client/plugos/event.ts
- client/plugos/eventhook.ts
- client/plugos/hooks/event.ts
---
The client-side [[Event]] bus that decouples components: code reacts to events (page loaded, file changed, sync status…) rather than calling each other directly.
