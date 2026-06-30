---
tags: component
partOf: "[[Architecture/Server]]"
consumes: "[[Architecture/Space Files]]"
references:
- server-common/src/space.rs
- server-common/src/space/disk.rs
- server-common/src/space/http.rs
---
The server's file-access and RPC surface behind the [[HTTP API]]: listing/reading/writing/deleting files, plus shell execution and the HTTP proxy.
