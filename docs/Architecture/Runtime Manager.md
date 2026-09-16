---
tags: component
partOf: "[[Architecture/Server]]"
connectsTo: "[[Architecture/Client]]"
references:
- server-runtime-chrome/src/supervisor.rs
- server-runtime-chrome/src/pool.rs
- server-runtime-chrome/src/lib.rs
---
The server starts an isolated headless Chrome client on demand for each user and space pair using the [[Runtime API]]. The runtime manager supervises these browsers and sends evaluation requests to the loaded client through Chrome DevTools Protocol.
