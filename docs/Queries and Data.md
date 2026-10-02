SilverBullet indexes your pages as objects with attributes; these pages explain that data model and how to query it.

${query[[
  from e = docsNav.pages
  where e.name:match "^Queries & Data/[^/]+$"
  select templates.docsPage(e)
]]}
