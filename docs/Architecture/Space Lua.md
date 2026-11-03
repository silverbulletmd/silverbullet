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
[[Space Lua]] is SilverBullet’s embedded Lua dialect and runtime for extensions. It implements most of the Lua 5.4 standard library plus Space Lua-specific [[API]]s, and can reach all [[Architecture/Syscalls]].
