This describes the APIs available in [[Space Lua]]:

# Lua Standard Library
${query[[
  from p = index.pages("api/lua")
  where p.tag == "page"
  order by p.name
  select templates.pageItem(p)
]]}

# Space Lua APIs
${query[[
  from p = index.pages("api/space-lua")
  where p.tag == "page"
  order by p.name
  select templates.pageItem(p)
]]}

# Syscall APIs
${query[[
  from p = index.pages("api/syscall")
  where p.tag == "page"
  order by p.name
  select templates.pageItem(p)
]]}