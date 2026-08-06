---
references:
- client/space_lua/stdlib.ts
- client/plugos/syscalls/index.ts
- plug-api/syscalls.ts
---
This describes the APIs available in [[Space Lua]]:

# Lua Standard Library
<!--#lua query[[
  from p = index.pages("api/lua")
  where p.tag == "page"
  order by p.name
  select templates.pageItem(p)
]] -->
* [[API/global]]
* [[API/math]]
* [[API/os]]
* [[API/string]]
* [[API/table]]
<!--/lua-->

# Space Lua APIs
<!--#lua query[[
  from p = index.pages("api/space-lua")
  where p.tag == "page"
  order by p.name
  select templates.pageItem(p)
]] -->
* [[API/command]]
* [[API/dom]]
* [[API/encoding]]
* [[API/http]]
* [[API/js]]
* [[API/jsonschema]]
* [[API/mq]]
* [[API/net]]
* [[API/slashCommand]]
* [[API/spacelua]]
* [[API/syntax]]
* [[API/tag]]
* [[API/taskState]]
* [[API/template]]
* [[API/widget]]
<!--/lua-->

# Syscall APIs
<!--#lua query[[
  from p = index.pages("api/syscall")
  where p.tag == "page"
  order by p.name
  select templates.pageItem(p)
]] -->
* [[API/asset]]
* [[API/clientStore]]
* [[API/codeWidget]]
* [[API/config]]
* [[API/datastore]]
* [[API/editor]]
* [[API/event]]
* [[API/index]]
* [[API/language]]
* [[API/lua]]
* [[API/markdown]]
* [[API/service]]
* [[API/shell]]
* [[API/space]]
* [[API/sync]]
* [[API/system]]
* [[API/yaml]]
<!--/lua-->