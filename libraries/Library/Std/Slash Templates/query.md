---
displayName: Query (code)
description: Insert a query
tags: meta/template/slash
icon: filter
group: Advanced
priority: 30
block: insert
exceptContexts:
- "FencedCode"
- "FrontMatter"
- "LuaDirective"
# raw: true
---
${"$"}{query[[
  from p = index.contentPages(|^|)
  select templates.pageItem(p)
]]}
