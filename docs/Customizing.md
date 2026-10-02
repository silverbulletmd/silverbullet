Make SilverBullet your own: scripting with Space Lua, commands, widgets and views, styling with Space Style, and more.

${query[[
  from e = docsNav.pages
  where e.name:match "^Customizing/[^/]+$"
  select templates.docsPage(e)
]]}
