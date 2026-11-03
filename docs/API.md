---
description: "Lua standard library, Space Lua APIs and SilverBullet syscalls."
references:
- client/space_lua/stdlib.ts
- client/plugos/syscalls/index.ts
- plug-api/syscalls.ts
---
This describes the APIs available in [[Space Lua]]:

# Lua Standard Library
<!--#lua query[[
  from p = index.contentPages("api/lua")
  order by p.name
  select template.new[==[* [[${name}|${name:match("[^/]+$")}]]]==](p)
]] -->
* [[API/global|global]]
* [[API/math|math]]
* [[API/os|os]]
* [[API/string|string]]
* [[API/table|table]]
<!--/lua-->

# Space Lua APIs
<!--#lua query[[
  from p = index.contentPages("api/space-lua")
  order by p.name
  select template.new[==[* [[${name}|${name:match("[^/]+$")}]]]==](p)
]] -->
* [[API/auth|auth]]
* [[API/command|command]]
* [[API/crypto|crypto]]
* [[API/dom|dom]]
* [[API/encoding|encoding]]
* [[API/github|github]]
* [[API/http|http]]
* [[API/identity|identity]]
* [[API/js|js]]
* [[API/jsonschema|jsonschema]]
* [[API/keyboardBar|keyboardBar]]
* [[API/mq|mq]]
* [[API/net|net]]
* [[API/pageVars|pageVars]]
* [[API/sbShare|sbShare]]
* [[API/share|share]]
* [[API/slashCommand|slashCommand]]
* [[API/spacelua|spacelua]]
* [[API/syntax|syntax]]
* [[API/tag|tag]]
* [[API/taskState|taskState]]
* [[API/template|template]]
* [[API/view|view]]
* [[API/widget|widget]]
* [[API/widgets|widgets]]
<!--/lua-->

# Syscall APIs
<!--#lua query[[
  from p = index.contentPages("api/syscall")
  order by p.name
  select template.new[==[* [[${name}|${name:match("[^/]+$")}]]]==](p)
]] -->
* [[API/asset|asset]]
* [[API/capture|capture]]
* [[API/clientStore|clientStore]]
* [[API/codeWidget|codeWidget]]
* [[API/config|config]]
* [[API/datastore|datastore]]
* [[API/editor|editor]]
* [[API/event|event]]
* [[API/icon|icon]]
* [[API/index|index]]
* [[API/language|language]]
* [[API/lua|lua]]
* [[API/markdown|markdown]]
* [[API/oauth|oauth]]
* [[API/object|object]]
* [[API/search|search]]
* [[API/service|service]]
* [[API/shell|shell]]
* [[API/space|space]]
* [[API/sync|sync]]
* [[API/system|system]]
* [[API/yaml|yaml]]
<!--/lua-->
