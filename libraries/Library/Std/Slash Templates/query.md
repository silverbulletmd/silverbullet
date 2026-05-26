---
description: Insert a query
tags: meta/template/slash
exceptContexts:
- "FencedCode:space-lua"
- "LuaDirective"
raw: true
---
${query[[
  from p = index.contentPages(|^|)
  select templates.pageItem(p)
]]}
