#meta

This page compiles some useful stats about your space. You may also like the [[^Library/Std/Pages/Maintenance]] page.

# Stats
**Total pages:** ${#query[[from index.pages() select name]]}
**Total documents:** ${#query[[from index.documents() select name]]}

# Active Plugs
These are all the plugs currently active in your space:
${query[[
  from space.listPlugs()
  select {name=string.gsub(_.name, "_plug/([^.]+).plug.js", "%1")}
]]}

# Active Space Lua
These are all Space Lua scripts and the order in which they are loaded:
${query[[
  from script = index.objects("space-lua")
  order by (script.priority or 0) desc, script.ref
  select template.new[==[
    * [[${ref}]] (priority: ${priority or "default"})
]==](script)
]]}

# Active Space Style
${query[[
  from s = index.objects("space-style")
  order by s.priority desc
  select templates.pageItem({name = s.ref})
]]}
