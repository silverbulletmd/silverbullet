---
tags: component
references:
- bin/silverbullet/src/server.rs
- server-common/src/space.rs
- server-common/src/space/http.rs
---
The Server owns file access and exposes the [[HTTP API]]. It serves the browser client, authenticates requests, enforces space access and coordinates file changes, including concurrent-edit reconciliation.

# Server services
* [[Search]] maintains a server-side full-text index and, when configured, a semantic index.
* [[Revisions]] maintains or reads Git history and can synchronize a managed repository with a remote.
* The [[Runtime API]] can run space operations through a managed headless client when configured and authorized.
* Multi-space deployments manage accounts, space membership and administration through the [[Dashboard]].

# Client responsibilities
The [[Architecture/Client]] builds the [[Object Index]] used by structured queries, runs Space Lua and plugs, and renders the editor. Browser [[Sync]] maintains configured content in local storage for offline work. This structured index is distinct from the Server’s search index.

Desktop embeds the shared server alongside its editor, working against a local folder. Its optional external Server connection is described in [[Desktop Sync]].
