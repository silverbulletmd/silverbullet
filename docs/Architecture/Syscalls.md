---
tags: component
partOf: "[[Architecture/Client]]"
connectsTo:
- "[[Architecture/Services]]"
- "[[Architecture/Events]]"
- "[[Architecture/Datastore]]"
---
System calls — the API boundary between SilverBullet and extension code ([[Architecture/Plugs|Plugs]] or [[Architecture/Space Lua|Space Lua]]). Core functionality (editor, events, datastore) is exposed through syscalls.
