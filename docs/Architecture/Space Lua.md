---
tags: component
partOf: "[[Architecture/Client]]"
connectsTo:
- "[[Architecture/Syscalls]]"
references:
- client/space_lua.ts
- client/space_lua/runtime.ts
- client/space_lua/parse.ts
---
SilverBullet's custom [[Lua]] runtime, [[Space Lua]] — the first-choice way to extend SilverBullet. It implements most of the Lua 5.4 standard library plus Space Lua-specific [[API]]s, and can reach all [[Architecture/Syscalls]].
