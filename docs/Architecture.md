#development

This page describes the big-picture view of SilverBullet, assembled from its [[#Components]]. Each component has its own page describing how it relates to the others, the diagram below is generated on-the-fly from the meta data in those pages.

# Top-level Architecture
<!--#lua mermaid.diagram(mermaid.relationGraph{
  pages = query[[from index.pages("component")]],
  relations = {"connectsTo", "consumes"},
  groupBy = "partOf",
  direction = "TB"
}) -->
```mermaid
flowchart TB
  subgraph n1 ["Client"]
    n3("Datastore")
    click n3 call __sbNav("Architecture/Datastore")
    n4("Editor")
    click n4 call __sbNav("Architecture/Editor")
    n5("Events")
    click n5 call __sbNav("Architecture/Events")
    n7("Plugs")
    click n7 call __sbNav("Architecture/Plugs")
    n11("Services")
    click n11 call __sbNav("Architecture/Services")
    n13("Space Lua")
    click n13 call __sbNav("Architecture/Space Lua")
    n15("Syscalls")
    click n15 call __sbNav("Architecture/Syscalls")
  end
  subgraph n9 ["Server"]
    n6("File System API")
    click n6 call __sbNav("Architecture/File System API")
    n8("Runtime Manager")
    click n8 call __sbNav("Architecture/Runtime Manager")
    n12("Space Files")
    click n12 call __sbNav("Architecture/Space Files")
  end
  subgraph n10 ["Service Worker"]
    n2("Client Bundle Cache")
    click n2 call __sbNav("Architecture/Client Bundle Cache")
    n14("Synced Files")
    click n14 call __sbNav("Architecture/Synced Files")
  end
  n1 -->|"connectsTo"| n10
  n4 -->|"connectsTo"| n15
  n6 -->|"consumes"| n12
  n7 -->|"connectsTo"| n15
  n8 -->|"consumes"| n12
  n10 -->|"connectsTo"| n9
  n13 -->|"connectsTo"| n15
  n15 -->|"connectsTo"| n11
  n15 -->|"connectsTo"| n5
  n15 -->|"connectsTo"| n3
```
<!--/lua-->

# The three layers
* [[Architecture/Client]]: one instance per browser tab; runs 90%+ of the logic ([[Architecture/Editor|editor]], [[Architecture/Space Lua|Space Lua]], [[Architecture/Plugs|plugs]], [[Architecture/Syscalls|syscalls]], [[Architecture/Datastore|datastore]]).
* [[Architecture/Service Worker]]: one instance per browser; offline cache + [[Sync]].
* [[Architecture/Server]]: — authentication, serving the client, and the file [[HTTP API]], otherwise a dumb file store.

# Components
Every box in the diagram is a page tagged `component`:

<!--#lua query[[
  from p = index.pages("component")
  order by p.name
  select templates.pageItem(p)
]] -->
* [[Architecture/Client]]
* [[Architecture/Client Bundle Cache]]
* [[Architecture/Datastore]]
* [[Architecture/Editor]]
* [[Architecture/Events]]
* [[Architecture/File System API]]
* [[Architecture/Plugs]]
* [[Architecture/Runtime Manager]]
* [[Architecture/Server]]
* [[Architecture/Service Worker]]
* [[Architecture/Services]]
* [[Architecture/Space Files]]
* [[Architecture/Space Lua]]
* [[Architecture/Synced Files]]
* [[Architecture/Syscalls]]
<!--/lua-->

