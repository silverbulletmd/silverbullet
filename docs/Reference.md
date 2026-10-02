Lookup material: Markdown syntax, the Space Lua API and standard library, configuration options, the CLI, and naming rules.

${query[[
  from e = docsNav.pages
  where e.name:match "^Reference/[^/]+$"
  select templates.docsPage(e)
]]}
