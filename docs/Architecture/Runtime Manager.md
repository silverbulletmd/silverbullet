---
tags: component
partOf: "[[Architecture/Server]]"
consumes: "[[Architecture/Space Files]]"
references:
- server-runtime-chrome/src/supervisor.rs
- server-runtime-chrome/src/transport.rs
- server-runtime-chrome/src/lib.rs
---
In order to implement the [[Runtime API]], 

The server’s file-access and RPC surface behind the [[HTTP API]]: listing/reading/writing/deleting files, plus shell execution and the HTTP proxy.
