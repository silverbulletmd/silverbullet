Everything about writing in SilverBullet: the editor, pages and documents, tasks and templates, and the pickers that get you around.

${query[[
  from e = docsNav.pages
  where e.name:match "^Writing/[^/]+$"
  select templates.docsPage(e)
]]}
