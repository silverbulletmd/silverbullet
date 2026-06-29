---
tags: component
partOf: "[[Architecture/Client]]"
connectsTo:
- "[[Architecture/Services]]"
- "[[Architecture/Events]]"
- "[[Architecture/Datastore]]"
references:
- plug-api/syscall.ts
- plug-api/syscalls.ts
- client/plugos/system.ts
---
System calls — the API boundary between SilverBullet and extension code ([[Architecture/Plugs|Plugs]] or [[Architecture/Space Lua|Space Lua]]). Core functionality (editor, events, datastore) is exposed through syscalls.
