#meta

This page compiles some useful stats about your space and may also be useful for debugging.

# Stats
**Total pages:** ${#query[[from index.tag "page" select name]]}
**Total documents:** ${#query[[from index.tag "document" select name]]}

# Active Space Lua
These are all Space Lua scripts and the order in which they are loaded:
${template.each(query[[
  from index.tag "space-lua"
  order by _.priority desc
]], template.new[==[
    * [[${ref}]] (priority: ${priority or "default"})
]==])}

# Active Space Style
${template.each(query[[
  from index.tag "space-style"
  order by _.priority desc
  select {name=ref}
]], templates.pageItem)}
