#development

SilverBullet has a browser client, a service worker and a server. The diagram is generated from the metadata on the [[#Components|component pages]], which describe each part and its connections.

# Top-level Architecture
${mermaid.diagram(mermaid.relationGraph{
  pages = query[[from index.pages("component")]],
  groupBy = "partOf",
  direction = "LR"
})}

# The three layers
* [[Architecture/Client]]: one instance per browser tab, running editing, structured indexing, queries and extensions ([[Architecture/Editor|editor]], [[Architecture/Space Lua|Space Lua]], [[Architecture/Plugs|plugs]], [[Architecture/Syscalls|syscalls]], [[Architecture/Datastore|datastore]]).
* [[Architecture/Service Worker]]: one instance per browser, providing an offline cache and [[Sync]].
* [[Architecture/Server]]: authentication, file access and reconciliation, server-backed search, revisions and optional runtime services.

The browser’s Object Index supports structured queries. The Server’s search index supports full-text and semantic search. They are separate systems. Desktop runs the shared client and a local embedded server against its local space. It does not need browser-style file synchronization between them. [[Desktop Sync]] optionally connects that folder to an external Server.

# Components
Every box in the diagram is a page tagged `component`:

* [[Architecture/Client|Client]]
* [[Architecture/Client Bundle Cache|Client Bundle Cache]]
* [[Architecture/Datastore|Datastore]]
* [[Architecture/Editor|Editor]]
* [[Architecture/Events|Events]]
* [[Architecture/File System API|File System API]]
* [[Architecture/Plugs|Plugs]]
* [[Architecture/Runtime Manager|Runtime Manager]]
* [[Architecture/Server|Server]]
* [[Architecture/Service Worker|Service Worker]]
* [[Architecture/Services|Services]]
* [[Architecture/Space Files|Space Files]]
* [[Architecture/Space Lua|Space Lua]]
* [[Architecture/Synced Files|Synced Files]]
* [[Architecture/Syscalls|Syscalls]]
