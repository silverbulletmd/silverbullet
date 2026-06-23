---
tags: component
partOf: "[[Architecture/Client]]"
connectsTo:
- "[[Architecture/Syscalls]]"
---
[[Plugs]] (built on the PlugOS library) extend SilverBullet in TypeScript, compiled to a single `.plug.js` bundle and distributed via a [[Library]]. Each plug runs in its own Web Worker sandbox. A lot of "built-in" functionality is in fact implemented as plugs.
