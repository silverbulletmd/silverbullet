---
tags: component
references:
- bin/silverbullet/src/server.rs
- server-common/src/space.rs
- server-common/src/space/http.rs
---
The server has only three jobs: handle authentication, serve the (static) client code, and implement the [[HTTP API]] (list/read/write/delete files, run shell commands). All indexing and querying happens in the [[Architecture/Client]] — the server is effectively a file store.
