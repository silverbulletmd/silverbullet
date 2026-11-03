---
description: Space Lua code blocks, run when the client boots.
tagKind: system
references:
- plugs/index/space_lua.ts
- client/space_lua.ts
---
Every `space-lua` block across your space is indexed with the `space-lua` tag. Upon client boot (or after using `System: Reload`), all space lua scripts are executed in sequence.

## Field reference
* `ref`: containing page and block position as `page@pos`.
* `script`: Lua source inside the fence.
* `range`: `[start, end]` range of the code inside the fence.
* `priority` (optional): number from the block’s `-- priority: <number>` comment. Higher priorities load first. See [[Space Lua#Definition loading]].

Blocks inside [[Markdown/Comment|comments]] are excluded so they do not load.
